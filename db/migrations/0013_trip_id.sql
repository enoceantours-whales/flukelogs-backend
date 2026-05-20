-- ============================================================================
-- Migration 0013 — trip identifier
-- ============================================================================
-- Until now a "trip" was identified only by (operator_id, trip_date), so two
-- trips run on the same calendar day collapsed into one everywhere: the public
-- widget, the captain's sightings views, the guest profile, audio notes.
--
-- This adds a real `trip_id` (uuid) to sightings, trip_guests and trip_audio
-- so same-day trips stay distinct, plus `trip_part` on sightings — the
-- Morning / Afternoon / Evening label, computed once at write time from the
-- trip's start time in the operator's timezone.
--
-- The legacy (operator_id, trip_date) UNIQUE constraints on trip_audio and
-- trip_guests are intentionally LEFT IN PLACE here so the currently-deployed
-- code keeps working. Migration 0014 drops them — run that only AFTER the
-- trip_id-aware code is live.
--
-- Idempotent. Paste into Supabase Dashboard -> SQL Editor -> Run.

-- ── Columns ──────────────────────────────────────────────────────────
alter table public.sightings   add column if not exists trip_id   uuid;
alter table public.sightings   add column if not exists trip_part  text;
alter table public.trip_guests add column if not exists trip_id    uuid;
alter table public.trip_audio  add column if not exists trip_id    uuid;

comment on column public.sightings.trip_id is
  'Groups every sighting logged in one trip report. Distinguishes two trips run on the same calendar day.';
comment on column public.sightings.trip_part is
  'Morning / Afternoon / Evening — derived from the trip start time in the operator timezone at write time.';

-- ── Backfill: one trip_id per historical trip ────────────────────────
-- A trip's sightings are all written in one request and share a created_at,
-- so grouping by (operator_id, trip_date, minute-of-created_at) recovers the
-- original trips: it keeps a single report's rows together while still
-- splitting two trips logged the same day hours apart. MATERIALIZED pins the
-- generated uuid so every row of a trip gets the same one.
with trips as materialized (
  select operator_id,
         trip_date,
         date_trunc('minute', created_at) as bucket,
         gen_random_uuid()                as new_trip_id
    from public.sightings
   where trip_id is null
   group by operator_id, trip_date, date_trunc('minute', created_at)
)
update public.sightings s
   set trip_id = t.new_trip_id
  from trips t
 where s.trip_id is null
   and s.operator_id = t.operator_id
   and s.trip_date   = t.trip_date
   and date_trunc('minute', s.created_at) = t.bucket;

-- Backfill trip_part from the trip's approximate start time (report
-- submission time minus the logged duration) in the operator's timezone.
update public.sightings s
   set trip_part = case
         when extract(hour from
                (s.created_at - make_interval(mins => coalesce(s.duration_minutes, 0)))
                at time zone coalesce(op.timezone, 'America/Los_Angeles')) < 12 then 'Morning'
         when extract(hour from
                (s.created_at - make_interval(mins => coalesce(s.duration_minutes, 0)))
                at time zone coalesce(op.timezone, 'America/Los_Angeles')) < 17 then 'Afternoon'
         else 'Evening'
       end
  from public.operators op
 where s.operator_id = op.id
   and s.trip_part is null;

-- Match each guest row to the sightings trip on the same (operator, date)
-- whose created_at is closest to the guest row's own created_at — guest rows
-- are written in the same request as the sightings, so the nearest timestamp
-- is the right trip.
update public.trip_guests g
   set trip_id = (
     select s.trip_id
       from public.sightings s
      where s.operator_id = g.operator_id
        and s.trip_date   = g.trip_date
        and s.trip_id is not null
      order by abs(extract(epoch from (s.created_at - g.created_at)))
      limit 1
   )
 where g.trip_id is null;

-- Audio is uploaded separately so its timestamp doesn't track the trip —
-- match it to the earliest sightings trip on that (operator, date). Before
-- this migration only one trip per date was addressable, so the earliest
-- (historically the only) trip is the correct target.
update public.trip_audio a
   set trip_id = (
     select s.trip_id
       from public.sightings s
      where s.operator_id = a.operator_id
        and s.trip_date   = a.trip_date
        and s.trip_id is not null
      order by s.created_at asc
      limit 1
   )
 where a.trip_id is null;

-- ── Per-trip uniqueness ──────────────────────────────────────────────
-- Lets PostgREST upserts target trip_id. Unique on a nullable column still
-- permits the NULLs that old-code inserts leave during the deploy window.
create unique index if not exists trip_audio_trip_id_key
  on public.trip_audio (trip_id);
create unique index if not exists trip_guests_trip_id_email_key
  on public.trip_guests (trip_id, email);

create index if not exists sightings_trip_id_idx   on public.sightings   (trip_id);
create index if not exists trip_guests_trip_id_idx  on public.trip_guests (trip_id);

-- ── guest_stats: count trips by trip_id ──────────────────────────────
-- A guest on two trips the same day is now two trips, not one.
create or replace function public.guest_stats(op_id uuid, email_in text)
returns table(trips int, species int) as $$
  with ids as (
    select distinct trip_id
      from trip_guests
     where operator_id = op_id
       and email       = lower(email_in)
       and trip_id is not null
  )
  select
    (select count(*)::int from ids),
    coalesce(
      (select count(distinct species)::int
         from sightings
        where operator_id = op_id
          and trip_id in (select trip_id from ids)),
      0);
$$ language sql stable;

-- ── Verify ───────────────────────────────────────────────────────────
--   select trip_date, trip_part, count(*), count(distinct trip_id)
--     from sightings group by trip_date, trip_part order by trip_date;
--   -- every row should have a trip_id; 2026-05-19 should show 2 distinct ids.
