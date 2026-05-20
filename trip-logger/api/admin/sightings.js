// GET /api/admin/sightings — every sighting across every operator (super-admin only).
//
// Used by the Admin portal's "All Sightings" screen to monitor activity
// across the fleet. The public widget at /api/sightings is single-operator
// by design; this endpoint is the admin counterpart that joins the operator
// row in so the table and map can group/color by operator.
//
// Optional filters:
//   ?operator_id=<uuid>   — restrict to one operator
//   ?since=YYYY-MM-DD     — only sightings on or after this trip_date
//   ?limit=<int>          — defaults to 500, capped at 2000

const { authenticateAsSuperAdmin } = require('../../lib/auth');

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

async function pgRest(path) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
    },
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (e) { /* leave as text */ }
  if (!res.ok) {
    const msg = (parsed && parsed.message) || text.slice(0, 200) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return parsed;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await authenticateAsSuperAdmin(req, res);
  if (!auth) return;

  const q = req.query || {};
  const filters = [];
  if (q.operator_id) filters.push(`operator_id=eq.${encodeURIComponent(String(q.operator_id))}`);
  if (q.since)       filters.push(`trip_date=gte.${encodeURIComponent(String(q.since))}`);

  const limit = Math.min(
    parseInt(String(q.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
    MAX_LIMIT,
  );

  // PostgREST embedded resource pulls the operator name + slug into each row
  // in a single round trip via the sightings → operators FK.
  const select = 'id,trip_id,trip_date,trip_part,species,count,lat,lng,depth_meters,behavior_notes,created_at,operator_id,operators(name,slug)';
  const params = [
    `select=${select}`,
    'order=trip_date.desc,created_at.desc',
    `limit=${limit}`,
    ...filters,
  ].join('&');

  try {
    const rows = await pgRest(`sightings?${params}`);
    // Flatten the embedded operator object so the client doesn't have to
    // reach through `.operators` — saves a layer of optional-chaining on
    // every render.
    const flat = (rows || []).map(r => ({
      id: r.id,
      trip_id: r.trip_id,
      trip_date: r.trip_date,
      trip_part: r.trip_part,
      species: r.species,
      count: r.count,
      lat: r.lat,
      lng: r.lng,
      depth_meters: r.depth_meters,
      behavior_notes: r.behavior_notes,
      created_at: r.created_at,
      operator_id: r.operator_id,
      operator_name: r.operators && r.operators.name,
      operator_slug: r.operators && r.operators.slug,
    }));
    return res.status(200).json(flat);
  } catch (err) {
    return res.status(500).json({ error: 'List sightings failed', detail: err.message });
  }
};
