// GET /api/guest/me — returns the current guest's identity + profile.
//
// The /profile SPA hits this on boot after Supabase consumes the magic
// link tokens from the URL. `profile: null` means the user hasn't filled
// out the form yet, and is the signal to route them to the "Create your
// profile" screen instead of the trip list.

const { authenticateGuest, setCORS } = require('../../lib/guest-auth');

module.exports = async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await authenticateGuest(req, res);
  if (!auth) return;

  const { user, profile } = auth;
  return res.status(200).json({
    user: { id: user.id, email: user.email },
    profile: profile && {
      first_name: profile.first_name,
      last_name:  profile.last_name,
      bio:        profile.bio,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
    },
  });
};
