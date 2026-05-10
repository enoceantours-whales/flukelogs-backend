// POST   /api/trip-audio   — upload a recording for {trip_date} and upsert
//                            the trip_audio row pointing at it
// DELETE /api/trip-audio?date=YYYY-MM-DD
//                          — remove the trip_audio row for that date
//                            (orphan file in the bucket is left alone — cheap
//                            to ignore for now, can add a sweeper later)
//
// Body for POST (JSON):
//   {
//     "trip_date":        "2026-05-09",
//     "content_type":     "audio/mp4" | "audio/webm" | "audio/mpeg" | "audio/ogg" | "audio/m4a",
//     "data_base64":      "<base64 audio>",
//     "duration_seconds": <number, optional>
//   }
//
// Response (200): { url, trip_date, duration_seconds, content_type }
//
// SETUP REQUIRED (one-time, by Slater in Supabase Dashboard):
//   Storage → New bucket → name `trip-audio` → toggle Public ON → Create.

const { authenticate } = require('../lib/auth');
const { getOperator } = require('../lib/operators');

const BUCKET = 'trip-audio';
const ALLOWED_TYPES = {
  'audio/mp4':  'm4a',
  'audio/m4a':  'm4a',
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/ogg':  'ogg',
};
const MAX_BYTES = 3 * 1024 * 1024; // 3MB — comfortably fits a 3-min recording
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

module.exports.config = {
  api: { bodyParser: { sizeLimit: '5mb' } },
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
  if (!res.ok) throw new Error(`Storage upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

function publicUrl(path) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

async function pgRest(method, path, body) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey':        key,
      'Authorization': `Bearer ${key}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation,resolution=merge-duplicates',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (e) { /* leave as text */ }
  if (!res.ok) {
    const msg = (parsed && parsed.message) || text.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return parsed;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = await authenticate(req, res);
  if (!auth) return;
  const { operatorId } = auth;

  if (req.method === 'POST') {
    const body = req.body || {};
    const { trip_date, content_type, data_base64 } = body;
    const duration_seconds = body.duration_seconds != null ? Math.round(Number(body.duration_seconds)) : null;

    if (!DATE_RE.test(String(trip_date || ''))) {
      return res.status(400).json({ error: 'trip_date must be YYYY-MM-DD' });
    }
    const ext = ALLOWED_TYPES[content_type];
    if (!ext) return res.status(400).json({ error: 'unsupported content_type' });
    if (typeof data_base64 !== 'string' || !data_base64) {
      return res.status(400).json({ error: 'data_base64 missing' });
    }

    let bytes;
    try { bytes = Buffer.from(data_base64, 'base64'); }
    catch (e) { return res.status(400).json({ error: 'data_base64 invalid' }); }
    if (bytes.length === 0) return res.status(400).json({ error: 'decoded audio is empty' });
    if (bytes.length > MAX_BYTES) {
      return res.status(413).json({ error: `audio too large (max ${MAX_BYTES} bytes / 3MB)` });
    }

    const operator = await getOperator(operatorId);
    const slug = (operator && operator.slug) || operatorId;
    const path = `${slug}/${trip_date}-${Date.now()}.${ext}`;
    const url  = publicUrl(path);

    try {
      await uploadToStorage(path, content_type, bytes);
    } catch (err) {
      console.error('trip-audio upload failed:', err.message);
      return res.status(500).json({ error: 'Upload failed', detail: err.message });
    }

    // Upsert the trip_audio row keyed on (operator_id, trip_date). Prefer
    // header `resolution=merge-duplicates` makes PostgREST do an UPSERT
    // against the unique constraint instead of erroring on conflict.
    try {
      const rows = await pgRest('POST', 'trip_audio?on_conflict=operator_id,trip_date', {
        operator_id:      operatorId,
        trip_date,
        audio_url:        url,
        duration_seconds,
        content_type,
        updated_at:       new Date().toISOString(),
      });
      const row = rows && rows[0];
      return res.status(200).json({
        url:              row ? row.audio_url : url,
        trip_date,
        duration_seconds: row ? row.duration_seconds : duration_seconds,
        content_type:     row ? row.content_type    : content_type,
      });
    } catch (err) {
      console.error('trip-audio upsert failed:', err.message);
      return res.status(500).json({ error: 'Save failed', detail: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const dateParam = String((req.query && req.query.date) || '').trim();
    if (!DATE_RE.test(dateParam)) return res.status(400).json({ error: 'date query param must be YYYY-MM-DD' });
    try {
      await pgRest('DELETE', `trip_audio?operator_id=eq.${operatorId}&trip_date=eq.${dateParam}`);
      return res.status(204).end();
    } catch (err) {
      console.error('trip-audio delete failed:', err.message);
      return res.status(500).json({ error: 'Delete failed', detail: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
