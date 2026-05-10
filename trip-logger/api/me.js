// GET /api/me — returns the current user's identity + operator config.
//
// The PWA hits this once on boot (after a successful login) to get the
// per-operator settings it needs: species dropdown contents, captain card
// branding (logo, name, website), buoy station, map center.
//
// Secrets (Mailchimp API key, Gmail app password, FareHarbor keys) are
// NEVER included — they stay server-side and are only used inside
// /api/send-report. publicOperatorView() in lib/operators.js enforces that.

const { authenticate } = require('../lib/auth');
const { getOperator, publicOperatorView } = require('../lib/operators');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Super admins may not be tied to any operator yet (they manage operators
  // from the admin portal). Don't 403 them — return null operator instead.
  const auth = await authenticate(req, res, { requireOperator: false });
  if (!auth) return;

  const { user, operatorId, isSuperAdmin } = auth;
  const operator = operatorId ? await getOperator(operatorId) : null;

  return res.status(200).json({
    user: {
      id:    user.id,
      email: user.email,
      is_super_admin: isSuperAdmin,
    },
    operator: publicOperatorView(operator),
  });
};
