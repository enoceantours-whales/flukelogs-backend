// POST /api/operator-logo-upload
//
// Accepts a base64-encoded logo image from a logged-in operator and stores it
// in the public Supabase Storage bucket `operator-logos`. Returns the public
// URL the caller can paste into operator.logo_url or operator.logo_url_email.
//
// Why server-side: keeps the Supabase service-role key off the client and
// lets us enforce the operator-isolation file-path scheme. Filenames include
// a timestamp for cache-busting (so a re-upload doesn't get served from a
// stale CDN cache).
//
// Body (JSON):
//   {
//     "kind":         "pdf" | "email",         // which logo slot
//     "content_type": "image/png" | "image/jpeg" | "image/webp",
//     "data_base64":  "<base64 string, no data: prefix>"
//   }
//
// Response (200):
//   { "url": "https://…supabase.co/storage/v1/object/public/operator-logos/…" }
//
// SETUP REQUIRED (one-time, by Slater in Supabase Dashboard):
//   Storage → New bucket → name "operator-logos" → toggle Public ON → Create.

const { authenticate } = require('../lib/auth');
const { getOperator } = require('../lib/operators');

const BUCKET = 'operator-logos';
const ALLOWED_TYPES = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const MAX_BYTES = 2 * 1024 * 1024; // 2MB decoded — plenty for a brand logo

// Allow up to 4mb body for the base64 payload (~3MB binary). Default Vercel
// Node body parser caps lower than that.
module.exports.config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
};

async function uploadToStorage(path, contentType, bytes) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'apikey':        key,
      'Content-Type':  contentType,
      'x-upsert':      'true',
    },
    body: bytes,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Storage upload ${res.status}: ${detail.slice(0, 200)}`);
  }
}

function publicUrl(path) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await authenticate(req, res);
  if (!auth) return;
  const { operatorId } = auth;

  const body = req.body || {};
  const { kind, content_type, data_base64 } = body;

  if (kind !== 'pdf' && kind !== 'email') {
    return res.status(400).json({ error: 'kind must be "pdf" or "email"' });
  }
  const ext = ALLOWED_TYPES[content_type];
  if (!ext) {
    return res.status(400).json({ error: 'content_type must be image/png, image/jpeg, or image/webp' });
  }
  if (typeof data_base64 !== 'string' || !data_base64) {
    return res.status(400).json({ error: 'data_base64 missing' });
  }

  let bytes;
  try { bytes = Buffer.from(data_base64, 'base64'); }
  catch (e) { return res.status(400).json({ error: 'data_base64 is not valid base64' }); }

  if (bytes.length === 0) {
    return res.status(400).json({ error: 'decoded image is empty' });
  }
  if (bytes.length > MAX_BYTES) {
    return res.status(413).json({ error: `image too large (max ${MAX_BYTES} bytes / 2MB), got ${bytes.length}` });
  }

  // Look up the slug so the path stays human-readable in the bucket.
  const operator = await getOperator(operatorId);
  const slug = (operator && operator.slug) || operatorId;

  const path = `${slug}/${kind}-${Date.now()}.${ext}`;
  try {
    await uploadToStorage(path, content_type, bytes);
  } catch (err) {
    console.error('logo upload failed:', err.message);
    return res.status(500).json({ error: 'Upload failed', detail: err.message });
  }

  return res.status(200).json({ url: publicUrl(path), path });
};
