// GET /api/guest/trips — every trip the guest has been emailed, with the
// sightings logged that day grouped under each trip. The /profile SPA
// renders this as a reverse-chronological timeline on the "My Trips" view.
//
// 403 if the guest hasn't created a profile yet — the SPA should be
// routing them to the form anyway, but we enforce it here so a stale
// session can't fetch trip data before the profile row exists (and so
// the backfill trigger has had a chance to fire).
//
// Three round-trips: trip_guests lookup, then operators + sightings in
// parallel. Service role bypasses RLS — the guest's scope is enforced by
// the trip_guests.guest_id = user.id filter. Sightings is fetched with
// an IN/IN clause (operator_id IN (..) AND trip_date IN (..)), which may
// over-fetch rows for unrelated (operator, date) pairs that happen to
// share a date or operator with one of this guest's trips. We group by
// the exact (operator_id, trip_date) tuple before returning so nothing
// outside this guest's trip set ever leaves the server.

const { authenticateGuest, setCORS } = require('../../lib/guest-auth');

module.exports = async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await authenticateGuest(req, res);
  if (!auth) return;

  const { user, profile } = auth;
  if (!profile) {
    return res.status(403).json({ error: 'Complete your profile before viewing trips' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error('Supabase env vars missing');
    return res.status(500).json({ error: 'Server misconfigured' });
  }
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

  try {
    const tripsRes = await fetch(
      `${url}/rest/v1/trip_guests?guest_id=eq.${user.id}&select=operator_id,trip_date&order=trip_date.desc`,
      { headers }
    );
    if (!tripsRes.ok) {
      console.error('trip_guests fetch failed:', tripsRes.status, (await tripsRes.text()).slice(0, 200));
      return res.status(502).json({ error: 'Failed to load trips' });
    }
    const tripRows = await tripsRes.json();
    if (tripRows.length === 0) {
      return res.status(200).json({ trips: [] });
    }

    // Dedupe to one entry per (operator_id, trip_date). The merge-duplicates
    // upsert in send-report.js should prevent duplicates at write time, but
    // a defensive collapse here keeps the rendered list clean.
    const tripKey = (r) => `${r.operator_id}|${r.trip_date}`;
    const tripMap = new Map();
    for (const r of tripRows) tripMap.set(tripKey(r), r);
    const uniqueTrips = Array.from(tripMap.values());
    const ownKeys = new Set(uniqueTrips.map(tripKey));

    const operatorIds = [...new Set(uniqueTrips.map(t => t.operator_id))];
    const tripDates   = [...new Set(uniqueTrips.map(t => t.trip_date))];

    const [opsRes, sightsRes] = await Promise.all([
      fetch(
        `${url}/rest/v1/operators?id=in.(${operatorIds.join(',')})&select=id,name,slug,tagline,logo_url_email`,
        { headers }
      ),
      fetch(
        `${url}/rest/v1/sightings`
          + `?operator_id=in.(${operatorIds.join(',')})`
          + `&trip_date=in.(${tripDates.join(',')})`
          + `&select=id,operator_id,trip_date,species,count,behavior_notes,lat,lng,water_temp,visibility,conditions,duration_minutes,distance_nm,passengers`
          + `&order=trip_date.desc`,
        { headers }
      ),
    ]);
    if (!opsRes.ok || !sightsRes.ok) {
      console.error('trips join fetch failed', opsRes.status, sightsRes.status);
      return res.status(502).json({ error: 'Failed to load trips' });
    }
    const operators = await opsRes.json();
    const sightings = await sightsRes.json();

    const opById = new Map(operators.map(o => [o.id, o]));

    // Bucket sightings into the (op, date) trips the guest actually attended.
    // Rows for cross-product (op, date) pairs the guest WAS NOT on are
    // dropped here.
    const sightingsByTrip = new Map();
    const tripMetaByKey = new Map();
    for (const s of sightings) {
      const k = `${s.operator_id}|${s.trip_date}`;
      if (!ownKeys.has(k)) continue;
      if (!sightingsByTrip.has(k)) sightingsByTrip.set(k, []);
      sightingsByTrip.get(k).push({
        id:             s.id,
        species:        s.species,
        count:          s.count,
        behavior_notes: s.behavior_notes,
        lat:            s.lat,
        lng:            s.lng,
      });
      // Trip-level conditions are denormalized onto every sighting row in
      // this schema, so any one of them is fine as a source for the trip
      // header. First write wins.
      if (!tripMetaByKey.has(k)) {
        tripMetaByKey.set(k, {
          duration_minutes: s.duration_minutes,
          distance_nm:      s.distance_nm,
          passengers:       s.passengers,
          water_temp:       s.water_temp,
          visibility:       s.visibility,
          conditions:       s.conditions,
        });
      }
    }

    const trips = uniqueTrips.map(t => {
      const op = opById.get(t.operator_id);
      const k = tripKey(t);
      const meta = tripMetaByKey.get(k) || {};
      return {
        operator_id:   t.operator_id,
        operator_name: op ? op.name : null,
        operator_slug: op ? op.slug : null,
        operator_logo: op ? op.logo_url_email : null,
        trip_date:     t.trip_date,
        duration_minutes: meta.duration_minutes || null,
        distance_nm:      meta.distance_nm || null,
        passengers:       meta.passengers || null,
        water_temp:       meta.water_temp || null,
        visibility:       meta.visibility || null,
        conditions:       meta.conditions || null,
        sightings: sightingsByTrip.get(k) || [],
      };
    });

    return res.status(200).json({ trips });
  } catch (err) {
    console.error('guest trips error:', err.message);
    return res.status(500).json({ error: 'Failed to load trips' });
  }
};
