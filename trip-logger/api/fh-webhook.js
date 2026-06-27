// FareHarbor booking webhook receiver.
//
// FH fires this URL on new + updated booking events (per the operator's
// webhook config in their FH dashboard). We resolve the operator from the
// payload's company.shortname, then upsert one row into the bookings table
// keyed on (operator_id, fh_uuid). Updates land on the same row.
//
// Pre-fill flow: the captain's trip-start screen later reads /api/operator/
// bookings?trip_date=YYYY-MM-DD to pre-fill passenger count + booker emails
// for the slot they're about to run.
//
// Always returns 200 unless the database itself errors, so FH doesn't retry
// us into the ground for payloads we can't handle (unknown operator, missing
// fields). Unknowns get logged and swallowed.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

const crypto = require('crypto');

// Shared-secret authentication for the webhook. FareHarbor's webhook config is
// a free-text URL with no signature/HMAC or custom-header option, so the only
// channel for a secret is the URL itself: configure the FH webhook URL as
// .../api/fh-webhook?key=<secret> and set FH_WEBHOOK_SECRET to the same value
// in the deployment env. A forged POST that doesn't carry the key is rejected.
//
// Rollout is log-then-enforce so live bookings never drop:
//   • FH_WEBHOOK_SECRET unset            -> no auth (current behaviour, safe default)
//   • set, FH_WEBHOOK_ENFORCE !== 'true' -> LOG ONLY: log pass/fail, still process
//   • set, FH_WEBHOOK_ENFORCE === 'true' -> reject calls without a valid key (401)
// Sequence: deploy -> set secret (log-only) -> update FH URL with ?key= ->
// confirm logs show 'key valid' -> set FH_WEBHOOK_ENFORCE=true.
const FH_WEBHOOK_SECRET  = process.env.FH_WEBHOOK_SECRET || '';
const FH_WEBHOOK_ENFORCE = process.env.FH_WEBHOOK_ENFORCE === 'true';

// Constant-time compare; returns null when no secret is configured at all.
function checkWebhookKey(req) {
  if (!FH_WEBHOOK_SECRET) return null;
  const provided = String((req.query && req.query.key) || req.headers['x-webhook-key'] || '');
  const a = Buffer.from(provided);
  const b = Buffer.from(FH_WEBHOOK_SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function pgGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`PostgREST GET ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function pgUpsert(table, row, onConflict) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`PostgREST upsert ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// FH start_at is e.g. "2026-05-11T09:00:00-0700". The first 10 chars are
// already the date in the operator's local timezone, which is what we want
// for trip_date grouping.
function tripDateFromStartAt(startAt) {
  if (typeof startAt !== 'string' || startAt.length < 10) return null;
  const d = startAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function findHeardAboutUs(customFieldValues) {
  if (!Array.isArray(customFieldValues)) return null;
  for (const cf of customFieldValues) {
    if (cf?.custom_field?.name === 'How did you hear about us?' && cf.display_value) {
      return cf.display_value;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Shared-secret gate (see header comment). null = not configured.
  const keyValid = checkWebhookKey(req);
  if (keyValid === false) {
    if (FH_WEBHOOK_ENFORCE) {
      console.warn('[FH-WEBHOOK] rejected: missing/invalid key');
      return res.status(401).json({ error: 'unauthorized' });
    }
    console.warn('[FH-WEBHOOK] LOG-ONLY: key missing/invalid (would reject when FH_WEBHOOK_ENFORCE=true)');
  } else if (keyValid === true && !FH_WEBHOOK_ENFORCE) {
    console.log('[FH-WEBHOOK] LOG-ONLY: key valid');
  }

  const payload = req.body;
  const booking = payload?.booking;
  if (!booking?.uuid || !booking?.company?.shortname) {
    console.warn('[FH-WEBHOOK] missing booking.uuid or company.shortname — ignored');
    return res.status(200).json({ ok: true, ignored: 'malformed' });
  }

  const tripDate = tripDateFromStartAt(booking.availability?.start_at);
  if (!tripDate) {
    console.warn('[FH-WEBHOOK] missing/invalid availability.start_at — ignored', booking.uuid);
    return res.status(200).json({ ok: true, ignored: 'no_start_at' });
  }

  try {
    const shortname = booking.company.shortname;
    const operators = await pgGet(
      `operators?fh_company_shortname=eq.${encodeURIComponent(shortname)}&select=id&limit=1`
    );
    const operatorId = operators[0]?.id;
    if (!operatorId) {
      console.warn(`[FH-WEBHOOK] unknown FH shortname "${shortname}" — ignored`);
      return res.status(200).json({ ok: true, ignored: 'unknown_operator' });
    }

    const row = {
      operator_id:         operatorId,
      fh_uuid:             booking.uuid,
      fh_pk:               booking.pk,
      fh_display_id:       booking.display_id || null,
      status:              booking.status || 'unknown',
      trip_date:           tripDate,
      start_at:            booking.availability.start_at,
      end_at:              booking.availability?.end_at || null,
      availability_pk:     booking.availability?.pk || null,
      item_pk:             booking.availability?.item?.pk || null,
      item_name:           booking.availability?.item?.name || null,
      contact_name:        booking.contact?.name || null,
      contact_email:       (booking.contact?.email || '').toLowerCase() || null,
      contact_phone:       booking.contact?.phone || null,
      customer_count:      Number.isFinite(booking.customer_count) ? booking.customer_count : 1,
      receipt_total_cents: Number.isFinite(booking.receipt_total) ? booking.receipt_total : null,
      amount_paid_cents:   Number.isFinite(booking.amount_paid) ? booking.amount_paid : null,
      heard_about_us:      findHeardAboutUs(booking.custom_field_values),
      raw:                 payload,
      updated_at:          new Date().toISOString(),
    };

    await pgUpsert('bookings', row, 'operator_id,fh_uuid');

    console.log(
      `[FH-WEBHOOK] upserted ${booking.uuid} op=${shortname} ` +
      `date=${tripDate} slot=${row.availability_pk} pax=${row.customer_count} status=${row.status}`
    );
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[FH-WEBHOOK] upsert failed:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
