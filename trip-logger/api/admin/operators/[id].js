// GET    /api/admin/operators/:id  — full operator row, including secrets
// PATCH  /api/admin/operators/:id  — partial update (any allowlisted field)
// DELETE /api/admin/operators/:id  — hard delete (cascades to operator_users
//                                    and sightings via FK ON DELETE)
//
// Super admin only — admin can view + edit any operator's full config
// including the fields the operator UI hides (gmail credentials, FareHarbor
// keys, NOAA buoy station, slug/name, etc.).

const { authenticateAsSuperAdmin } = require('../../../lib/auth');
const { ADMIN_WRITABLE } = require('../operators');

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

function adminOperatorView(op) {
  if (!op) return null;
  // Super admin can see everything except the actual stored Mailchimp API key
  // value (masked, same convention as the operator settings endpoint). They
  // can OVERWRITE it via PATCH; reading it back is masked.
  const out = { ...op };
  out.has_mailchimp_api_key = !!op.mailchimp_api_key;
  delete out.mailchimp_api_key;
  // Same masking for the Gmail app password and FareHarbor keys.
  out.has_gmail_app_password = !!op.gmail_app_password;
  delete out.gmail_app_password;
  out.has_fh_app_key = !!op.fh_app_key;
  out.has_fh_user_key = !!op.fh_user_key;
  delete out.fh_app_key;
  delete out.fh_user_key;
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = await authenticateAsSuperAdmin(req, res);
  if (!auth) return;

  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Missing id' });

  if (req.method === 'GET') {
    try {
      const rows = await pgRest('GET', `operators?id=eq.${encodeURIComponent(id)}&limit=1`);
      if (!rows || rows.length === 0) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(adminOperatorView(rows[0]));
    } catch (err) {
      return res.status(500).json({ error: 'Lookup failed', detail: err.message });
    }
  }

  if (req.method === 'PATCH') {
    const body = req.body || {};
    const updates = {};
    for (const f of ADMIN_WRITABLE) {
      if (!(f in body)) continue;
      const val = body[f];
      // Empty secret fields = "keep current value" — same convention the
      // operator settings UI uses for the Mailchimp key.
      if ((f === 'mailchimp_api_key' || f === 'gmail_app_password' || f === 'fh_app_key' || f === 'fh_user_key')
          && (val === '' || val === null || val === undefined)) continue;
      if (f === 'species_list' && !Array.isArray(val)) {
        return res.status(400).json({ error: 'species_list must be an array' });
      }
      updates[f] = val;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No editable fields provided' });
    }
    updates.updated_at = new Date().toISOString();

    try {
      const rows = await pgRest('PATCH', `operators?id=eq.${encodeURIComponent(id)}`, updates);
      if (!rows || rows.length === 0) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(adminOperatorView(rows[0]));
    } catch (err) {
      return res.status(500).json({ error: 'Update failed', detail: err.message });
    }
  }

  if (req.method === 'DELETE') {
    // Refuse to delete the operator the super admin themselves are using as
    // their captain account — easy way to lock yourself out.
    if (auth.operatorId && auth.operatorId === id) {
      return res.status(400).json({ error: 'Refusing to delete your own current operator' });
    }
    try {
      await pgRest('DELETE', `operators?id=eq.${encodeURIComponent(id)}`);
      return res.status(204).end();
    } catch (err) {
      return res.status(500).json({ error: 'Delete failed', detail: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
