// POST /api/demo-request — public endpoint that receives demo-request
// form submissions from the /landing page and writes them to the
// public.demo_requests table (service-role bypasses RLS).
//
// Public — no auth header. Anyone can submit, but the table is read-
// gated so submissions are only visible via Supabase Table Editor /
// service-role queries.
//
// Validation is light on purpose (this is a marketing form, not a
// security boundary): require name + email + company; cap text fields
// at sane lengths to keep junk payloads bounded; reject on obvious
// email-format failures. The DB is the source of truth — we don't
// dedupe here, every submission gets a row.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME    = 120;
const MAX_EMAIL   = 200;
const MAX_COMPANY = 200;
const MAX_WEBSITE = 300;
const MAX_MESSAGE = 4000;
const MAX_UA      = 300;

async function pgInsert(row) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  const res = await fetch(`${url}/rest/v1/demo_requests`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(row),
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
  return parsed && parsed[0];
}

function trim(value, max) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const name    = trim(body.name,    MAX_NAME);
  const email   = trim(body.email,   MAX_EMAIL);
  const company = trim(body.company, MAX_COMPANY);
  const website = trim(body.website, MAX_WEBSITE);
  const message = trim(body.message, MAX_MESSAGE);
  const source  = trim(body.source,  60) || 'landing-page';

  if (!name)    return res.status(400).json({ error: 'Name is required' });
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (!company) return res.status(400).json({ error: 'Company is required' });

  const userAgent = trim(req.headers['user-agent'], MAX_UA);

  try {
    await pgInsert({
      name,
      email: email.toLowerCase(),
      company,
      website,
      message,
      source,
      user_agent: userAgent,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('demo-request insert failed:', err.message);
    return res.status(500).json({ error: 'Could not record request', detail: err.message });
  }
};
