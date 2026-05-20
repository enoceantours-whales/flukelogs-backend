// GET /api/operator/trips
//
// Returns the operator's recent trips with sighting counts and audio
// status. The Past Trips screen uses this to render the list where the
// captain picks a trip to record (or re-record) audio for.
//
// Two PostgREST queries (no JOIN aggregation in PostgREST so we merge in
// JS): one to pull sightings grouped into trips by trip_id, one to pull
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
      `&select=trip_id,trip_date,trip_part,species,count,created_at` +
      `&order=trip_date.desc&limit=2000`
    );

    // Group by trip_id — two trips run the same calendar day stay separate.
    // A row with no trip_id (pre-0013 data) falls back to its date as a key.
    const byTrip = new Map();
    for (const s of sightings) {
      const k = s.trip_id || s.trip_date;
      if (!byTrip.has(k)) {
        byTrip.set(k, {
          trip_id:    s.trip_id || null,
          trip_date:  s.trip_date,
          trip_part:  s.trip_part || null,
          created_at: s.created_at || '',
          sighting_count: 0, animal_count: 0, species: new Set(),
        });
      }
      const g = byTrip.get(k);
      g.sighting_count += 1;
      g.animal_count += parseInt(s.count, 10) || 0;
      if (s.species) g.species.add(s.species);
    }

    // Newest trip first: by date, then created_at so a day's evening trip
    // sorts above its morning trip. Capped at LIMIT_TRIPS.
    const trips = Array.from(byTrip.values())
      .sort((a, b) =>
        b.trip_date.localeCompare(a.trip_date) ||
        String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, LIMIT_TRIPS);

    // Pull audio status for those trips in a single round-trip, keyed by
    // trip_id (pre-0013 trips with no trip_id can't carry trip_id audio).
    const idList = trips.map(t => t.trip_id).filter(Boolean).map(id => `"${id}"`).join(',');
    const audioRows = idList
      ? await pgGet(`trip_audio?operator_id=eq.${operatorId}&trip_id=in.(${idList})&select=trip_id,audio_url,duration_seconds`)
      : [];
    const audioByTrip = new Map(audioRows.map(r => [r.trip_id, r]));

    const out = trips.map(t => {
      const audio = t.trip_id ? audioByTrip.get(t.trip_id) : null;
      return {
        trip_id:          t.trip_id,
        trip_date:        t.trip_date,
        trip_part:        t.trip_part,
        sighting_count:   t.sighting_count,
        animal_count:     t.animal_count,
        species_count:    t.species.size,
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
