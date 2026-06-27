// GET    /api/trip-photos?trip_id=<uuid>  - list a trip's gallery (captain edit UI)
// POST   /api/trip-photos                 - upload ONE photo for {trip_id}, insert a row
// DELETE /api/trip-photos?id=<uuid>        - remove one photo row (orphan file left
//                                            in the bucket, cheap to ignore for now)
//
// Photos are keyed on trip_id so each trip carries its own gallery. One photo per
// request keeps payloads small and lets a flaky boat connection upload the set
// one at a time with partial success. The public widget never calls this; it
// reads photos through the service-role /api/widget-data endpoint.
//
// Body for POST (JSON):
//   {
//     "trip_id":      "<uuid>",
//     "trip_date":    "2026-05-09",
//     "content_type": "image/jpeg" | "image/png" | "image/webp",
//     "data_base64":  "<base64 image>",
//     "sort_order":   <number, optional>
//   }
//
// Response (200): { id, url, trip_id, trip_date, sort_order }
//
// SETUP: storage bucket `trip-photos` (public) is created by migration 0020's
// companion bucket insert. The trip_photos table is created in migration 0020.

const { authenticate } = require('../lib/auth');
const { getOperator } = require('../lib/operators');

const BUCKET = 'trip-photos';
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
};
const MAX_BYTES = 8 * 1024 * 1024; // 8MB per photo (client resizes to ~2560px JPEG)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports.config = {
  api: { bodyParser: { sizeLimit: '12mb' } },
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
      'Prefer':        'return=representation',
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = await authenticate(req, res);
  if (!auth) return;
  const { operatorId } = auth;

  if (req.method === 'GET') {
    const tripIdParam = String((req.query && req.query.trip_id) || '').trim();
    if (!UUID_RE.test(tripIdParam)) return res.status(400).json({ error: 'trip_id query param must be a uuid' });
    try {
      const rows = await pgRest(
        'GET',
        `trip_photos?operator_id=eq.${operatorId}&trip_id=eq.${tripIdParam}` +
        `&select=id,photo_url,sort_order,created_at&order=sort_order.asc,created_at.asc`
      );
      return res.status(200).json({ photos: rows || [] });
    } catch (err) {
      console.error('trip-photos list failed:', err.message);
      return res.status(500).json({ error: 'List failed', detail: err.message });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const { trip_id, trip_date, content_type, data_base64 } = body;
    const sort_order = body.sort_order != null ? Math.round(Number(body.sort_order)) : 0;

    if (!UUID_RE.test(String(trip_id || ''))) {
      return res.status(400).json({ error: 'trip_id must be a uuid' });
    }
    if (!DATE_RE.test(String(trip_date || ''))) {
      return res.status(400).json({ error: 'trip_date must be YYYY-MM-DD' });
    }
    const baseType = String(content_type || '').split(';')[0].trim().toLowerCase();
    const ext = ALLOWED_TYPES[baseType];
    if (!ext) return res.status(400).json({ error: `unsupported content_type: ${content_type}` });
    if (typeof data_base64 !== 'string' || !data_base64) {
      return res.status(400).json({ error: 'data_base64 missing' });
    }

    let bytes;
    try { bytes = Buffer.from(data_base64, 'base64'); }
    catch (e) { return res.status(400).json({ error: 'data_base64 invalid' }); }
    if (bytes.length === 0) return res.status(400).json({ error: 'decoded image is empty' });
    if (bytes.length > MAX_BYTES) {
      return res.status(413).json({ error: `photo too large (max ${MAX_BYTES} bytes / 8MB)` });
    }

    const operator = await getOperator(operatorId);
    const slug = (operator && operator.slug) || operatorId;
    const path = `${slug}/${trip_id}/${Date.now()}-${Math.floor(sort_order)}.${ext}`;
    const url  = publicUrl(path);

    try {
      await uploadToStorage(path, baseType, bytes);
    } catch (err) {
      console.error('trip-photos upload failed:', err.message);
      return res.status(500).json({ error: 'Upload failed', detail: err.message });
    }

    try {
      const rows = await pgRest('POST', 'trip_photos', {
        operator_id: operatorId,
        trip_id,
        trip_date,
        photo_url:   url,
        sort_order,
      });
      const row = rows && rows[0];
      return res.status(200).json({
        id:         row ? row.id : null,
        url:        row ? row.photo_url : url,
        trip_id,
        trip_date,
        sort_order: row ? row.sort_order : sort_order,
      });
    } catch (err) {
      console.error('trip-photos insert failed:', err.message);
      return res.status(500).json({ error: 'Save failed', detail: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const idParam = String((req.query && req.query.id) || '').trim();
    if (!UUID_RE.test(idParam)) return res.status(400).json({ error: 'id query param must be a uuid' });
    try {
      await pgRest('DELETE', `trip_photos?operator_id=eq.${operatorId}&id=eq.${idParam}`);
      return res.status(204).end();
    } catch (err) {
      console.error('trip-photos delete failed:', err.message);
      return res.status(500).json({ error: 'Delete failed', detail: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
