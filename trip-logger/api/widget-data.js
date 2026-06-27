// GET /api/widget-data?op=<slug> — public data feed for the sightings widget.
//
// WHY THIS EXISTS (tenant isolation):
//   The widget used to read the `sightings` and `trip_audio` tables directly
//   from the browser with the anon key, under an RLS policy of USING (true).
//   That made the per-operator scoping client-side only: anyone holding the
//   anon key could read EVERY operator's rows (including GPS) regardless of
//   the ?op= slug. This endpoint moves that read server-side behind the
//   service role and scopes it to one operator, so the anon SELECT policies
//   on sightings/trip_audio can be removed (see db/migrations/0018).
//
//   It also makes the `show_map_on_widget = false` opt-out REAL: when an
//   operator has hidden their map, lat/lng are stripped here, server-side,
//   instead of merely being hidden by widget JavaScript.
//
// Operator is resolved from the `?op=<slug>` query param against the
// operators table — the client never supplies the operator_id, so it can't
// ask for another operator's rows. Unknown/missing slug => empty feed.
//
// Shapes match exactly what sightings-widget.html's fetchSightings() and
// fetchTripAudio() previously got from PostgREST, so the widget is a drop-in
// swap:
//   { sightings: [ {trip_id,trip_part,trip_date,sighting_time,species,count,
//                    lat,lng,depth_meters,created_at}, … ],
//     audio:     [ {trip_id,audio_url,duration_seconds,play_count}, … ],
//     tracks:    { <trip_id>: [ {lat,lng,t}, … ], … },
//     show_map_on_widget: <bool> }
//
// `tracks` is the continuous GPS breadcrumb per trip (Phase 2). When
// show_map_on_widget = false, tracks is empty AND lat/lng are stripped from
// sightings — same opt-out applies to both.

const FEED_LIMIT = 100;

async function pgGet(pathAndQuery) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Same freshness posture as the widget HTML — sightings land continuously
  // and the feed should reflect new trips without a stale-cache delay.
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const empty = { sightings: [], audio: [], show_map_on_widget: true };

  try {
    const slug = req.query && req.query.op;
    if (!slug) { res.status(200).json(empty); return; }

    // Resolve operator server-side from the public slug. We only need the id
    // and the map toggle here.
    const ops = await pgGet(
      `operators?slug=eq.${encodeURIComponent(String(slug))}&select=id,show_map_on_widget&limit=1`
    );
    const operator = ops && ops[0];
    if (!operator || !operator.id) { res.status(200).json(empty); return; }

    const operatorId = operator.id;
    const showMap = operator.show_map_on_widget !== false;

    const [sightings, audio] = await Promise.all([
      pgGet(
        `sightings?operator_id=eq.${operatorId}` +
        `&select=trip_id,trip_part,trip_date,sighting_time,species,count,lat,lng,depth_meters,created_at` +
        `&order=trip_date.desc,created_at.desc&limit=${FEED_LIMIT}`
      ),
      pgGet(
        `trip_audio?operator_id=eq.${operatorId}` +
        `&select=trip_id,audio_url,duration_seconds,play_count` +
        `&order=trip_date.desc&limit=${FEED_LIMIT}`
      ),
    ]);

    // Enforce the GPS opt-out server-side: when the operator hides their map,
    // never send coordinates to the browser at all.
    const sightingRows = (sightings || []).map(s => {
      if (showMap) return s;
      const { lat, lng, ...rest } = s;
      return rest;
    });

    // Continuous breadcrumb tracks per trip. Only fetched when the operator
    // exposes their map (same opt-out as lat/lng on sightings). Scoped by the
    // exact trip_ids that came back in `sightings` — never returns tracks for
    // trips that aren't already in this feed.
    let tracks = {};
    if (showMap) {
      const tripIds = [...new Set(sightingRows.map(s => s.trip_id).filter(Boolean))];
      if (tripIds.length) {
        const idList = tripIds.map(id => `"${id}"`).join(',');
        const trackRows = await pgGet(
          `trip_track?operator_id=eq.${operatorId}` +
          `&trip_id=in.(${idList})` +
          `&select=trip_id,lat,lng,recorded_at` +
          `&order=trip_id.asc,recorded_at.asc&limit=20000`
        );
        for (const p of (trackRows || [])) {
          if (!tracks[p.trip_id]) tracks[p.trip_id] = [];
          tracks[p.trip_id].push({ lat: p.lat, lng: p.lng, t: p.recorded_at });
        }
      }
    }

    res.status(200).json({
      sightings: sightingRows,
      audio: audio || [],
      tracks,
      show_map_on_widget: showMap,
    });
  } catch (err) {
    console.error('widget-data error:', err.message);
    res.status(200).json(empty); // fail soft — widget shows its empty state
  }
};
