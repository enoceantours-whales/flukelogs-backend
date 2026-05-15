// POST /api/guest/profile — upsert the current guest's profile.
//
// Body: { first_name, last_name, bio }. first_name OR last_name is
// required so the trips list has something to show. On first INSERT,
// the backfill trigger in migration 0010 populates trip_guests.guest_id
// for every historic row matching the guest's auth email, so the next
// /api/guest/trips call surfaces every trip we've already emailed them.
//
// The email + user_id come from the verified JWT — never from the body —
// so a guest cannot create or hijack another user's profile by spoofing
// fields. We go through the service role for symmetry with the rest of
// the codebase; RLS policies in migration 0010 would also permit it.

const { authenticateGuest, setCORS } = require('../../lib/guest-auth');

const MAX_BIO = 2000;
const MAX_NAME = 80;

function trimOrNull(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s.length ? s : null;
}

module.exports = async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await authenticateGuest(req, res);
  if (!auth) return;

  const { user } = auth;
  const body = req.body || {};

  const first_name = trimOrNull(body.first_name, MAX_NAME);
  const last_name  = trimOrNull(body.last_name,  MAX_NAME);
  const bio        = trimOrNull(body.bio,        MAX_BIO);

  if (!first_name && !last_name) {
    return res.status(400).json({ error: 'first_name or last_name is required' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error('Supabase env vars missing');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const row = {
    user_id:    user.id,
    email:      String(user.email || '').toLowerCase().trim(),
    first_name,
    last_name,
    bio,
  };

  try {
    const upsert = await fetch(`${url}/rest/v1/guest_profiles?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        'apikey':        key,
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(row),
    });
    if (!upsert.ok) {
      const detail = (await upsert.text()).slice(0, 300);
      console.error('guest_profiles upsert failed:', upsert.status, detail);
      return res.status(502).json({ error: 'Failed to save profile' });
    }
    const rows = await upsert.json();
    const saved = Array.isArray(rows) ? rows[0] : rows;
    return res.status(200).json({
      profile: {
        first_name: saved.first_name,
        last_name:  saved.last_name,
        bio:        saved.bio,
        created_at: saved.created_at,
        updated_at: saved.updated_at,
      },
    });
  } catch (err) {
    console.error('guest profile upsert error:', err.message);
    return res.status(500).json({ error: 'Failed to save profile' });
  }
};
