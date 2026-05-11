// POST /api/admin/operators/invite — super-admin "+ New Operator" wizard.
//
// Bundles the three steps of bringing a new operator online into a single
// call so the super-admin never has to touch SQL:
//
//   1. Insert a row in `operators` with slug + name + optional defaults
//   2. Create an auth user via Supabase's invite endpoint — this also sends
//      a magic-link email so the captain can set their password
//   3. Insert a row in `operator_users` linking the user to the operator
//      with role='owner'
//
// On any step failure we try to roll back the previous steps so we don't
// leave half-onboarded operators lying around. Step 2 (auth user creation)
// sends a real email the moment it succeeds — once that's sent there's no
// way to un-send it, but we can still delete the auth user if linking fails.

const { authenticateAsSuperAdmin } = require('../../../lib/auth');

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

// Supabase GoTrue admin API. The invite endpoint creates an auth user AND
// sends them a magic-link email in one shot. Requires the service-role key.
async function inviteAuthUser(email, captainName) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const body = { email };
  if (captainName) body.data = { full_name: captainName };
  const res = await fetch(`${url}/auth/v1/invite`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (e) { /* fall through */ }
  if (!res.ok) {
    const msg = (parsed && (parsed.msg || parsed.error_description || parsed.error)) || text.slice(0, 200) || `Auth HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return parsed; // { id, email, ... }
}

async function deleteAuthUser(userId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  try {
    await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
    });
  } catch (e) {
    console.error('Rollback: failed to delete auth user', userId, e.message);
  }
}

async function deleteOperator(operatorId) {
  try {
    await pgRest('DELETE', `operators?id=eq.${operatorId}`);
  } catch (e) {
    console.error('Rollback: failed to delete operator', operatorId, e.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await authenticateAsSuperAdmin(req, res);
  if (!auth) return;

  const body = req.body || {};
  const slug = String(body.slug || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const email = String(body.captain_email || '').trim().toLowerCase();
  const captainName = body.captain_name ? String(body.captain_name).trim() : null;

  if (!SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'slug must be lowercase letters/numbers/hyphens, 1-40 chars, no leading/trailing hyphen' });
  }
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'captain_email must be a valid email address' });
  }

  // Step 1: operator row. If the slug is taken we bail before touching auth
  // so we don't accidentally invite a captain to a half-built operator.
  let operatorId = null;
  try {
    const rows = await pgRest('POST', 'operators', { slug, name });
    operatorId = rows[0].id;
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes('duplicate')) {
      return res.status(409).json({ error: `An operator with slug "${slug}" already exists` });
    }
    return res.status(500).json({ error: 'Create operator failed', detail: err.message });
  }

  // Step 2: auth user + invite email. If this fails we delete the operator
  // row so the super-admin can retry with a fresh slug.
  let userId = null;
  try {
    const user = await inviteAuthUser(email, captainName);
    userId = user && user.id;
    if (!userId) throw new Error('Auth API returned no user id');
  } catch (err) {
    await deleteOperator(operatorId);
    const msg = String(err.message || '').toLowerCase();
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return res.status(409).json({
        error: `An auth user with email ${email} already exists. Pick a different email or link the existing user manually.`,
      });
    }
    return res.status(500).json({ error: 'Invite captain failed', detail: err.message });
  }

  // Step 3: link the user to the operator. If this fails we delete both
  // the auth user and the operator row — the captain hasn't logged in yet,
  // so the magic-link email becomes harmless dead-letter.
  try {
    await pgRest('POST', 'operator_users', {
      user_id:     userId,
      operator_id: operatorId,
      role:        'owner',
    });
  } catch (err) {
    await deleteAuthUser(userId);
    await deleteOperator(operatorId);
    return res.status(500).json({ error: 'Link captain to operator failed', detail: err.message });
  }

  return res.status(201).json({
    operator_id: operatorId,
    slug,
    name,
    captain: { user_id: userId, email },
    invite_sent: true,
  });
};
