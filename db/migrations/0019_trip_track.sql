-- ============================================================================
-- Migration 0019 — trip_track (continuous GPS breadcrumbs per trip)
-- ============================================================================
-- Phase 2 native iOS work captures GPS continuously through the trip, including
-- while the screen is locked (via the background-location plugin). Persist the
-- breadcrumb so the public widget can draw the boat's real path instead of
-- straight pin-to-pin lines, and so trip distance can be recomputed
-- server-side from the canonical track later if we ever need to.
--
-- Per-row size is tiny (~40 bytes). A 4-hour trip captured every ~5s is
-- roughly 3,000 rows / ~120 KB. send-report.js downsamples to 500 points
-- max on insert so a noisy device never blows up the table.
--
-- RLS: enabled, no anon SELECT (the public widget reads through service-role
-- /api/widget-data). No client INSERT path either; only the server's send
-- handler writes rows, using the service role which bypasses RLS.
--
-- The PWA on the web keeps recording too (browser navigator.geolocation only
-- fires in the foreground, so its tracks are sparser than the native app's)
-- so even pre-Phase-2-app users get a track stored going forward.
--
-- Idempotent. Paste into Supabase Dashboard -> SQL Editor -> Run.

create table if not exists public.trip_track (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null,
  operator_id uuid not null references public.operators(id) on delete cascade,
  lat         numeric not null,
  lng         numeric not null,
  recorded_at timestamptz not null,
  accuracy_m  numeric
);

comment on table public.trip_track is
  'Continuous GPS breadcrumbs captured during a trip, used to draw the actual boat path on the public widget instead of straight sighting-to-sighting lines.';

create index if not exists trip_track_trip_id_time_idx
  on public.trip_track (trip_id, recorded_at);
create index if not exists trip_track_operator_id_idx
  on public.trip_track (operator_id);

alter table public.trip_track enable row level security;
-- No policies. service_role (the server) bypasses RLS, anon (the browser)
-- gets nothing. Matches the posture for sightings/trip_audio after 0018.

-- ── Verify ───────────────────────────────────────────────────────────
--   select count(*) from trip_track;          -- expect 0 (no points yet)
--   select tablename, rowsecurity from pg_tables where tablename = 'trip_track';
--   -- expect rowsecurity = t
