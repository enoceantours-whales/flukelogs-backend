// FareHarbor webhook receiver — TEMPORARY CAPTURE-ONLY VERSION.
//
// Purpose: receive 1-2 real booking webhook payloads from FareHarbor so we
// know the exact shape of the JSON, then this file gets rewritten to do
// the real thing (validate, dedup by booking UUID, upsert into Supabase).
//
// What this version does:
//   1. Accept POST only (other methods return 405)
//   2. Parse the JSON body
//   3. Log the full payload + headers to Vercel function logs
//   4. Return 200 OK fast so FH doesn't retry
//
// To inspect a captured payload:
//   Vercel dashboard -> trip-logger-backend -> Logs -> filter for /api/fh-webhook
//   Look for "[FH-WEBHOOK]" markers.
//
// To configure in FareHarbor:
//   Settings -> Users & Permissions -> [your user] -> Webhooks -> + Add webhook
//   Schema:    Bookings only (or Bookings only - Optimized)
//   Trigger:   Updated bookings  (catches new + email corrections)
//   URL:       https://trip-logger-backend.vercel.app/api/fh-webhook

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', method: req.method });
  }

  // Vercel auto-parses JSON when content-type is application/json. Fall back
  // to whatever was sent so we can still log non-JSON payloads.
  const body = req.body;

  // Log markers make it easy to grep the Vercel logs later.
  console.log('[FH-WEBHOOK] ───── new payload ─────');
  console.log('[FH-WEBHOOK] received_at:', new Date().toISOString());
  console.log('[FH-WEBHOOK] headers:', JSON.stringify(req.headers, null, 2));
  console.log('[FH-WEBHOOK] body:', JSON.stringify(body, null, 2));
  console.log('[FH-WEBHOOK] ───── end payload ─────');

  // Acknowledge fast so FareHarbor doesn't retry.
  return res.status(200).json({ ok: true, captured: true });
};
