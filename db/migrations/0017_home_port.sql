-- ============================================================================
-- Migration 0017 — home port + re-spread old trip replay order
-- ============================================================================
-- The public widget's replay animation needs a real harbor location to (a)
-- end the line at the dock and (b) re-spread older trips' sightings in a
-- plausible boat path (close-to-far). default_map_center can be offshore
-- (Enocean's is mid-bay), so add explicit home_port_lat / home_port_lng on
-- operators.
--
-- Then re-write sighting_time for trips logged before the real-times
-- capture went live (migration 0016, deployed 2026-06-18). The first
-- backfill used arbitrary id order, which made the animation start at
-- random pins. This pass orders each trip's sightings by squared distance
-- from the home port ascending — close to far — so the replay looks like
-- a boat heading out and coming back.
--
-- Idempotent. Paste into Supabase Dashboard -> SQL Editor -> Run.

alter table public.operators
  add column if not exists home_port_lat numeric,
  add column if not exists home_port_lng numeric;

comment on column public.operators.home_port_lat is
  'Latitude of the operator''s home dock. Anchors the public widget''s trip-replay animation and orders historic trips by distance.';
comment on column public.operators.home_port_lng is
  'Longitude of the operator''s home dock.';

-- Enocean Tours -> Moss Landing Harbor.
update public.operators
   set home_port_lat = 36.803,
       home_port_lng = -121.787
 where slug = 'enocean'
   and home_port_lat is null;

-- Re-spread sighting_time for trips logged before real per-sighting times
-- started being captured. Distance is squared lat/lng — fine as a sort
-- key over a single bay, and avoids the cost of sqrt.
update public.sightings s
   set sighting_time = (
     ((o.created_at - make_interval(mins => o.duration_minutes))
        + make_interval(mins => round(o.idx::numeric * o.duration_minutes / greatest(o.n - 1, 1))::int))
     at time zone coalesce(o.tz, 'America/Los_Angeles')
   )::time
  from (
    select s.id, s.duration_minutes, s.created_at, op.timezone as tz,
           row_number() over (
             partition by s.trip_id
             order by
               case
                 when op.home_port_lat is not null and op.home_port_lng is not null
                 then (s.lat - op.home_port_lat) * (s.lat - op.home_port_lat)
                    + (s.lng - op.home_port_lng) * (s.lng - op.home_port_lng)
                 else 0
               end asc,
               s.id
           ) - 1 as idx,
           count(*) over (partition by s.trip_id) as n
      from public.sightings s
      join public.operators op on op.id = s.operator_id
     where s.trip_date <= '2026-06-16'
       and s.lat is not null
       and s.lng is not null
  ) o
 where s.id = o.id;

-- ── Verify ───────────────────────────────────────────────────────────
--   select slug, home_port_lat, home_port_lng from operators;
--   select trip_date, count(*), min(sighting_time)::text, max(sighting_time)::text
--     from sightings where trip_date <= '2026-06-16'
--     group by trip_date order by trip_date;
