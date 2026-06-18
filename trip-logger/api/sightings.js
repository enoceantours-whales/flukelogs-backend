// GET /api/sightings — serves the public sightings-widget.html.
//
// The widget needs a tiny amount of per-operator config (currently just
// show_map_on_widget). We look up that operator row server-side and inject
// it as `window.__OP_CONFIG` so the widget can read it synchronously at boot
// without an extra round-trip to Supabase and without exposing the operators
// table to the anon key.
//
// Operator is resolved from the `?op=<slug>` query param, falling back to
// the only active operator if a single one exists, or `enocean` as a final
// default.
//
// When the URL also carries `?trip=<trip id>` (set by the in-widget
// share button), we fetch that trip's sightings server-side and inject
// per-trip OG / Twitter meta tags so iMessage / WhatsApp / Twitter link
// previews render a proper card (operator + date + species summary)
// instead of a bare URL. The shared link's recipient then sees the
// widget itself with that trip already pre-selected.

const fs = require('fs');
const path = require('path');

const DEFAULT_SLUG = 'enocean';

async function loadOperatorRow(slug) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  try {
    const safeSlug = encodeURIComponent(slug);
    const res = await fetch(
      `${url}/rest/v1/operators?slug=eq.${safeSlug}&select=id,slug,name,show_map_on_widget,logo_url,logo_url_email,widget_host_url,home_port_lat,home_port_lng&limit=1`,
      { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch (e) {
    console.error('sightings widget: operator lookup failed:', e.message);
    return null;
  }
}

async function loadTripSummary(operatorId, tripId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !operatorId || !tripId) return null;
  // trip_id is a uuid; reject anything else so a malformed ?trip= just
  // falls through to the generic operator-level OG card.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tripId)) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/sightings?operator_id=eq.${operatorId}&trip_id=eq.${encodeURIComponent(tripId)}&select=species,count,trip_date,trip_part`,
      { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows.length) return null;
    const speciesSet = new Set();
    let animals = 0;
    rows.forEach(r => {
      if (r.species) speciesSet.add(r.species);
      animals += parseInt(r.count, 10) || 0;
    });
    return {
      trip_date: rows[0].trip_date,
      trip_part: rows[0].trip_part || null,
      species: Array.from(speciesSet),
      animals,
    };
  } catch (e) {
    console.error('sightings widget: trip summary lookup failed:', e.message);
    return null;
  }
}

function htmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Render a human-friendly UTC date label so iMessage/Twitter previews
// don't show ISO strings. Server-side intentionally — keeps the rendered
// HTML cacheable per (op, trip) pair without timezone surprises.
function prettyTripDate(iso) {
  try {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      timeZone: 'UTC',
    });
  } catch { return iso; }
}

function buildOgTags({ operator, trip, requestUrl }) {
  const operatorName = (operator && operator.name) || 'Trip Logger';
  const image = operator && (operator.logo_url_email || operator.logo_url);
  let title, description;

  if (trip) {
    const speciesList = trip.species.slice(0, 4).join(', ') +
      (trip.species.length > 4 ? '…' : '');
    title = `Sightings on ${prettyTripDate(trip.trip_date)}${trip.trip_part ? ' · ' + trip.trip_part : ''} — ${operatorName}`;
    description = `${trip.species.length} species, ${trip.animals} animals seen: ${speciesList}. Listen to the captain's notes from this trip.`;
  } else {
    title = `Recent sightings — ${operatorName}`;
    description = `Live sightings log from ${operatorName}. Every trip updated with species seen, GPS pins, and the captain's audio recap.`;
  }

  const tags = [
    `<meta property="og:title" content="${htmlEscape(title)}">`,
    `<meta property="og:description" content="${htmlEscape(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${htmlEscape(requestUrl)}">`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${htmlEscape(title)}">`,
    `<meta name="twitter:description" content="${htmlEscape(description)}">`,
    `<meta name="description" content="${htmlEscape(description)}">`,
  ];
  if (image) {
    tags.push(`<meta property="og:image" content="${htmlEscape(image)}">`);
    tags.push(`<meta name="twitter:image" content="${htmlEscape(image)}">`);
  }
  return tags.join('\n');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/html');
  try {
    const slug = (req.query && req.query.op) || DEFAULT_SLUG;
    const tripParam = req.query && req.query.trip;

    const operator = await loadOperatorRow(slug);
    // Home dock anchor for the widget's trip-replay animation — the line
    // ends here. PostgREST returns numeric as a string, so parseFloat.
    const portLat = operator && parseFloat(operator.home_port_lat);
    const portLng = operator && parseFloat(operator.home_port_lng);
    const homePort = Number.isFinite(portLat) && Number.isFinite(portLng)
      ? { lat: portLat, lng: portLng }
      : null;
    const opConfig = operator
      ? {
          id: operator.id,
          slug: operator.slug,
          show_map_on_widget: operator.show_map_on_widget !== false,
          // Public URL of the operator's embed page — used by the in-widget
          // share button so shared links land on their branded site, not
          // the bare vercel widget URL. Null = fall back to vercel domain.
          widget_host_url: operator.widget_host_url || null,
          home_port: homePort,
        }
      : { id: null, slug, show_map_on_widget: true, widget_host_url: null, home_port: null };

    // Per-trip enrichment only when both the operator AND the trip resolve
    // — otherwise fall through to the generic operator-level OG.
    const trip = (operator && tripParam)
      ? await loadTripSummary(operator.id, String(tripParam))
      : null;

    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = req.headers.host;
    const requestUrl = `${proto}://${host}${req.url || ''}`;
    const ogTags = buildOgTags({ operator, trip, requestUrl });

    const filePath = path.join(__dirname, 'sightings-widget.html');
    let html = fs.readFileSync(filePath, 'utf8');

    const configScript = `<script>window.__OP_CONFIG = ${JSON.stringify(opConfig)};</script>`;
    html = html.replace('</head>', `${ogTags}\n${configScript}\n</head>`);

    res.status(200).send(html);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
};
