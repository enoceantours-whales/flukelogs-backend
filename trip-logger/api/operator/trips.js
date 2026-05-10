// GET /api/operator/trips
//
// Returns the operator's recent trip dates with sighting counts and audio
// status. The Past Trips screen uses this to render the list where the
// captain picks a date to record (or re-record) audio for.
//
// Two PostgREST queries (no JOIN aggregation in PostgREST so we merge in
// JS): one to pull distinct dates + counts from sightings, one to pull
// trip_audio rows. Then we stitch them together. Limited to the most
// recent 60 trips — plenty for any practical past-recording use case.

const { authenticate } = require('../../lib/auth');

const LIMIT_TRIPS = 60;

async function pgGet(path) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`PostgREST ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await authenticate(req, res);
  if (!auth) return;
  const { operatorId } = auth;

  try {
    // Pull every sighting for this operator (operator_id-tagged since Step 3)
    // ordered by trip_date desc. We aggregate in JS so we can keep the schema
    // simple and avoid a Postgres view migration. For an operator with years
    // of data this would need a real aggregation, but for whale-watch
    // volumes it's negligible.
    const sightings = await pgGet(
      `sightings?operator_id=eq.${operatorId}` +
      `&select=trip_date,species,count` +
      `&order=trip_date.desc&limit=2000`
    );

    // Group by trip_date
    const byDate = new Map();
    for (const s of sightings) {
      const k = s.trip_date;
      if (!byDate.has(k)) byDate.set(k, { trip_date: k, sighting_count: 0, animal_count: 0, species: new Set() });
      const g = byDate.get(k);
      g.sighting_count += 1;
      g.animal_count += parseInt(s.count, 10) || 0;
      if (s.species) g.species.add(s.species);
    }

    // Newest dates first, capped at LIMIT_TRIPS
    const dates = Array.from(byDate.values())
      .sort((a, b) => b.trip_date.localeCompare(a.trip_date))
      .slice(0, LIMIT_TRIPS);

    // Pull audio status for those dates in a single round-trip
    const dateList = dates.map(d => `"${d.trip_date}"`).join(',');
    const audioRows = dateList
      ? await pgGet(`trip_audio?operator_id=eq.${operatorId}&trip_date=in.(${dateList})&select=trip_date,audio_url,duration_seconds`)
      : [];
    const audioByDate = new Map(audioRows.map(r => [r.trip_date, r]));

    const out = dates.map(d => {
      const audio = audioByDate.get(d.trip_date);
      return {
        trip_date:        d.trip_date,
        sighting_count:   d.sighting_count,
        animal_count:     d.animal_count,
        species_count:    d.species.size,
        has_audio:        !!audio,
        audio_url:        audio ? audio.audio_url : null,
        duration_seconds: audio ? audio.duration_seconds : null,
      };
    });

    return res.status(200).json(out);
  } catch (err) {
    console.error('operator/trips failed:', err.message);
    return res.status(500).json({ error: 'Lookup failed', detail: err.message });
  }
};
