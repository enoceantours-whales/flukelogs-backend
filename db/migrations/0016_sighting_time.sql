-- ============================================================================
-- Migration 0016 — per-sighting time
-- ============================================================================
-- The captain app already captures a time per sighting (the Time picker on
-- the Log Sighting screen), but the value was being dropped on send. Persist
-- it now so the public widget can replay a trip pin-by-pin in the order it
-- actually unfolded.
--
-- Old sightings lost their original times — we never recorded them. The
-- backfill below spreads each trip's existing sightings evenly across its
-- duration (using id order as a stable arbitrary order), so the replay
-- animation has something to draw. Going forward, real times are stored.
--
-- Idempotent. Paste into Supabase Dashboard -> SQL Editor -> Run.

alter table public.sightings
  add column if not exists sighting_time time;

comment on column public.sightings.sighting_time is
  'Local time-of-day the captain logged this sighting at (operator timezone). Drives the trip-replay animation on the public sightings widget.';

-- Backfill: spread each trip's existing sightings evenly across its
-- duration. With n=1 the lone sighting lands at trip start; with n>=2 the
-- first and last land at trip start / end and the rest are evenly spaced.
update public.sightings s
   set sighting_time = (
     ((o.created_at - make_interval(mins => o.duration_minutes))
        + make_interval(mins => round(o.idx::numeric * o.duration_minutes / greatest(o.n - 1, 1))::int))
     at time zone coalesce(op.timezone, 'America/Los_Angeles')
   )::time
  from (
    select id, operator_id, duration_minutes, created_at,
           row_number() over (partition by trip_id order by id) - 1 as idx,
           count(*)     over (partition by trip_id)                 as n
      from public.sightings
     where sighting_time is null
  ) o, public.operators op
 where s.id = o.id
   and op.id = o.operator_id;

-- ── Verify ───────────────────────────────────────────────────────────
--   select trip_date, count(*), min(sighting_time)::text, max(sighting_time)::text
--     from sightings group by trip_date order by trip_date;
--   -- every row should have a sighting_time; range should fit the trip.
