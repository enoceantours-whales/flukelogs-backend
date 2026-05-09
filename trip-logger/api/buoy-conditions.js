// Pulls the latest observation from an NDBC buoy and returns water temp,
// wave height, wind, and an estimated sea state mapped to the captain's
// existing sea-conditions dropdown. The trip-start screen calls this on
// load so the captain confirms instead of typing.
//
// Default station: 46092 (MBARI M1, inshore central Monterey Bay — sits
// right in the middle of the typical whale-watch area). M1 doesn't carry
// wave sensors so WVHT/DPD/MWD are always MM; sea state falls through to
// the Beaufort wind-speed mapping below, which is fine for inshore chop
// where local wind drives the surface more than offshore swell.
//
// If you want offshore swell data, use station=46042 (Monterey, ~27 NM
// WNW) — it has the full wave sensor suite.
//
// Source: https://www.ndbc.noaa.gov/data/realtime2/{STATION}.txt
// Format is space-delimited text with two header rows beginning with `#`.
// Missing values are encoded as `MM`. Observations update every 10 min.

const https = require('https');

const DEFAULT_STATION = '46092';
const STATION_RE = /^\d{4,5}[A-Z]?$/; // basic shape check, e.g. "46042" or "BLIA2"

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('NDBC HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('NDBC timeout')); });
  });
}

// Parse the most recent valid value for each field, scanning back up to
// `maxRows` rows (some fields like WVHT only update every 20 min, so the
// top row may have MM while a row 1-2 entries down has data).
function parseLatest(text) {
  const rows = text.split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.trim().split(/\s+/));
  if (!rows.length) return null;

  const findField = (idx, maxRows = 12) => {
    for (let i = 0; i < Math.min(maxRows, rows.length); i++) {
      const v = rows[i][idx];
      if (v && v !== 'MM') {
        const n = parseFloat(v);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  };

  // Column indexes per the NDBC realtime2 header
  // YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE
  //  0  1  2  3  4   5    6   7   8    9  10  11  12   13   14   15  16  17   18
  const wtmp_c  = findField(14);
  const wvht_m  = findField(8);
  const wspd_ms = findField(6);
  const wdir    = findField(5);

  const r0 = rows[0];
  const obs = `${r0[0]}-${r0[1]}-${r0[2]}T${r0[3]}:${r0[4]}:00Z`;

  return {
    water_temp_f:    wtmp_c   != null ? Math.round((wtmp_c * 9/5 + 32) * 10) / 10 : null,
    wave_height_ft:  wvht_m   != null ? Math.round(wvht_m * 3.28084 * 10) / 10    : null,
    wave_height_m:   wvht_m,
    wind_kt:         wspd_ms  != null ? Math.round(wspd_ms * 1.94384)              : null,
    wind_dir_deg:    wdir,
    observed_at_utc: obs,
  };
}

// Map measured conditions to one of the four labels in the captain's
// existing Sea Conditions dropdown. Prefers wave height; falls back to a
// rough Beaufort-style read on wind speed when wave height is missing.
function seaState({ wave_height_m, wind_kt }) {
  if (wave_height_m != null) {
    if (wave_height_m < 0.5)  return 'Calm';
    if (wave_height_m < 1.25) return 'Slight Chop';
    if (wave_height_m < 2.5)  return 'Moderate Chop';
    return 'Rough';
  }
  if (wind_kt != null) {
    if (wind_kt < 7)  return 'Calm';
    if (wind_kt < 16) return 'Slight Chop';
    if (wind_kt < 24) return 'Moderate Chop';
    return 'Rough';
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // NDBC publishes every 10 min; cache 5 min at the edge to be polite
  res.setHeader('Cache-Control', 'public, s-maxage=300, max-age=60');

  const requested = (req.query && req.query.station) || DEFAULT_STATION;
  const station = STATION_RE.test(String(requested)) ? String(requested) : DEFAULT_STATION;

  try {
    const text = await fetchText(`https://www.ndbc.noaa.gov/data/realtime2/${station}.txt`);
    const obs = parseLatest(text);
    if (!obs) {
      return res.status(502).json({ error: 'No observations parsed', station });
    }
    obs.sea_state = seaState(obs);
    obs.station = station;
    obs.source = `NOAA NDBC buoy ${station}`;
    return res.status(200).json(obs);
  } catch (err) {
    return res.status(502).json({ error: 'Buoy fetch failed', detail: err.message, station });
  }
};
