// GET /api/operator/bookings?trip_date=YYYY-MM-DD
//
// Returns the operator's FareHarbor bookings for a date, grouped by
// availability slot (e.g. 9am vs 1pm on the same date). Used by the
// trip-start screen to pre-fill passenger count + booker emails.
//
// Response shape:
//   {
//     trip_date: "2026-05-11",
//     slots: [
//       {
//         availability_pk: 2030411301,
//         start_at: "2026-05-11T09:00:00-0700",
//         end_at:   "2026-05-11T12:00:00-0700",
//         item_name: "3hr Whale Watch",
//         booking_count: 2,
//         customer_count: 5,
//         booker_emails: ["alice@example.com", "bob@example.com"]
//       },
//       ...
//     ]
//   }
//
// Cancelled bookings are excluded.

const { authenticate } = require('../../lib/auth');

async function pgGet(path) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`PostgREST ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await authenticate(req, res);
  if (!auth) return;
  const { operatorId } = auth;

  const tripDate = (req.query?.trip_date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tripDate)) {
    return res.status(400).json({ error: 'trip_date must be YYYY-MM-DD' });
  }

  try {
    const rows = await pgGet(
      `bookings?operator_id=eq.${operatorId}` +
      `&trip_date=eq.${tripDate}` +
      `&status=neq.cancelled` +
      `&select=availability_pk,start_at,end_at,item_name,customer_count,contact_email` +
      `&order=start_at.asc`
    );

    // Group by availability_pk so the UI can render one card per slot.
    const slots = new Map();
    for (const r of rows) {
      const key = r.availability_pk ?? `noslot-${r.start_at}`;
      if (!slots.has(key)) {
        slots.set(key, {
          availability_pk: r.availability_pk,
          start_at:        r.start_at,
          end_at:          r.end_at,
          item_name:       r.item_name,
          booking_count:   0,
          customer_count:  0,
          booker_emails:   new Set(),
        });
      }
      const slot = slots.get(key);
      slot.booking_count  += 1;
      slot.customer_count += Number(r.customer_count) || 0;
      if (r.contact_email) slot.booker_emails.add(r.contact_email);
    }

    const out = Array.from(slots.values())
      .sort((a, b) => (a.start_at || '').localeCompare(b.start_at || ''))
      .map(s => ({ ...s, booker_emails: Array.from(s.booker_emails) }));

    return res.status(200).json({ trip_date: tripDate, slots: out });
  } catch (err) {
    console.error('operator/bookings failed:', err.message);
    return res.status(500).json({ error: 'Lookup failed', detail: err.message });
  }
};
