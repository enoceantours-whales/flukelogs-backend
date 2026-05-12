// GET  /api/admin/operators        — list every operator (super admin only)
// POST /api/admin/operators        — create a new operator (super admin only)
//
// All operator fields are accepted on create. Only `slug` and `name` are
// strictly required; the rest can be filled in later via the same admin UI
// or by the operator themselves on the Settings screen.

const { authenticateAsSuperAdmin } = require('../../lib/auth');

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

// Every operator field a super admin is allowed to write on create. Mirror
// of the operators table (minus auto-generated id / timestamps). Anything
// outside this list is silently ignored.
const ADMIN_WRITABLE = [
  'slug', 'name',
  'logo_url', 'logo_url_email', 'review_url', 'tagline', 'website_url',
  'species_list',
  'from_email', 'gmail_user', 'gmail_app_password',
  'mailchimp_api_key', 'mailchimp_audience_id', 'mailchimp_server_prefix',
  'noaa_buoy_station', 'default_map_center', 'default_map_zoom',
  'fh_company_shortname', 'fh_app_key', 'fh_user_key',
  'tripadvisor_id', 'google_business_id',
  'widget_host_url',
  'active',
];

async function pgRest(method, path, body) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = await authenticateAsSuperAdmin(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    try {
      const rows = await pgRest('GET', 'operators?select=id,slug,name,active,created_at&order=created_at.asc');
      return res.status(200).json(rows || []);
    } catch (err) {
      return res.status(500).json({ error: 'List failed', detail: err.message });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const slug = String(body.slug || '').trim().toLowerCase();
    const name = String(body.name || '').trim();

    if (!SLUG_RE.test(slug)) {
      return res.status(400).json({ error: 'slug must be lowercase letters/numbers/hyphens, 1-40 chars, no leading/trailing hyphen' });
    }
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const insert = { slug, name };
    for (const f of ADMIN_WRITABLE) {
      if (f === 'slug' || f === 'name') continue;
      if (f in body) insert[f] = body[f];
    }
    if ('species_list' in insert && !Array.isArray(insert.species_list)) {
      return res.status(400).json({ error: 'species_list must be an array' });
    }

    try {
      const rows = await pgRest('POST', 'operators', insert);
      return res.status(201).json(rows[0]);
    } catch (err) {
      // Duplicate slug -> Postgres unique violation
      if (err.message && err.message.includes('duplicate')) {
        return res.status(409).json({ error: `An operator with slug "${slug}" already exists` });
      }
      return res.status(500).json({ error: 'Create failed', detail: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

module.exports.ADMIN_WRITABLE = ADMIN_WRITABLE;
