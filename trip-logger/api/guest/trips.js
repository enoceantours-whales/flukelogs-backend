// GET /api/guest/trips — every trip the guest has been emailed, with the
// sightings logged on it grouped under each trip. The /profile SPA renders
// this as a reverse-chronological timeline on the "My Trips" view.
//
// 403 if the guest hasn't created a profile yet — the SPA should be
// routing them to the form anyway, but we enforce it here so a stale
// session can't fetch trip data before the profile row exists (and so
// the backfill trigger has had a chance to fire).
//
// Three round-trips: trip_guests lookup, then operators + sightings in
// parallel. Service role bypasses RLS — the guest's scope is enforced by
// the trip_guests.guest_id = user.id filter. Sightings are fetched by
// trip_id IN (...), so every row returned belongs to one of this guest's
// own trips — no cross-operator/date over-fetch to filter back out.

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
      `${url}/rest/v1/trip_guests?guest_id=eq.${user.id}&select=operator_id,trip_id,trip_date&order=trip_date.desc`,
      { headers }
    );
    if (!tripsRes.ok) {
      console.error('trip_guests fetch failed:', tripsRes.status, (await tripsRes.text()).slice(0, 200));
      return res.status(502).json({ error: 'Failed to load trips' });
    }
    const tripRows = await tripsRes.json();

    // Dedupe to one entry per trip_id. Rows are guaranteed a trip_id from
    // migration 0013 on; any older un-backfilled row is skipped (it isn't
    // individually addressable).
    const tripMap = new Map();
    for (const r of tripRows) {
      if (r.trip_id && !tripMap.has(r.trip_id)) tripMap.set(r.trip_id, r);
    }
    const uniqueTrips = Array.from(tripMap.values());
    if (uniqueTrips.length === 0) {
      return res.status(200).json({ trips: [] });
    }

    const operatorIds = [...new Set(uniqueTrips.map(t => t.operator_id))];
    const tripIds     = uniqueTrips.map(t => t.trip_id);

    const [opsRes, sightsRes] = await Promise.all([
      fetch(
        `${url}/rest/v1/operators?id=in.(${operatorIds.join(',')})&select=id,name,slug,tagline,logo_url_email`,
        { headers }
      ),
      fetch(
        `${url}/rest/v1/sightings`
          + `?trip_id=in.(${tripIds.join(',')})`
          + `&select=id,trip_id,trip_date,trip_part,species,count,behavior_notes,lat,lng,water_temp,visibility,conditions,duration_minutes,distance_nm,passengers`
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

    // Bucket sightings by trip_id. Fetching by trip_id means every row
    // returned already belongs to one of this guest's trips.
    const sightingsByTrip = new Map();
    const tripMetaByTrip  = new Map();
    for (const s of sightings) {
      const k = s.trip_id;
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
      if (!tripMetaByTrip.has(k)) {
        tripMetaByTrip.set(k, {
          trip_date:        s.trip_date,
          trip_part:        s.trip_part,
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
      const meta = tripMetaByTrip.get(t.trip_id) || {};
      return {
        trip_id:       t.trip_id,
        operator_id:   t.operator_id,
        operator_name: op ? op.name : null,
        operator_slug: op ? op.slug : null,
        operator_logo: op ? op.logo_url_email : null,
        trip_date:     meta.trip_date || t.trip_date,
        trip_part:     meta.trip_part || null,
        duration_minutes: meta.duration_minutes || null,
        distance_nm:      meta.distance_nm || null,
        passengers:       meta.passengers || null,
        water_temp:       meta.water_temp || null,
        visibility:       meta.visibility || null,
        conditions:       meta.conditions || null,
        sightings: sightingsByTrip.get(t.trip_id) || [],
      };
    });

    return res.status(200).json({ trips });
  } catch (err) {
    console.error('guest trips error:', err.message);
    return res.status(500).json({ error: 'Failed to load trips' });
  }
};
