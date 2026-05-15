// Shared authentication helpers for the guest-facing API endpoints.
//
// A "guest" is a Supabase auth user with a row in public.guest_profiles.
// Distinct from the operator/captain flow in ../lib/auth.js — guests
// have no operator_id, no super_admin flag, and aren't allowed into
// any /api/admin or /api/operator endpoint.
//
// Every /api/guest/* route MUST call authenticateGuest() before touching
// data. RLS (migration 0010) is a defense-in-depth layer; this gate is
// the primary one.

async function verifyJWT(token) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !token) return null;
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body && body.id ? body : null;
  } catch (e) {
    console.error('guest verifyJWT error:', e.message);
    return null;
  }
}

async function getGuestProfile(userId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !userId) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/guest_profiles?user_id=eq.${userId}&select=*&limit=1`,
      { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch (e) {
    console.error('getGuestProfile error:', e.message);
    return null;
  }
}

// Verifies the bearer token and loads the guest's profile row (if any).
// Returns { user, profile } — profile is null on first login, which is
// the signal for the SPA to show the "create profile" form. Writes a
// 401 to res on auth failure and returns null; caller should `return`.
async function authenticateGuest(req, res) {
  const header = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization bearer token' });
    return null;
  }
  const user = await verifyJWT(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return null;
  }
  const profile = await getGuestProfile(user.id);
  return { user, profile };
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = { verifyJWT, getGuestProfile, authenticateGuest, setCORS };
