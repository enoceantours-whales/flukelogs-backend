-- ============================================================================
-- Migration 0014 — drop legacy (operator_id, trip_date) uniqueness
-- ============================================================================
-- The trip_audio and trip_guests tables were created (migrations 0003, 0004)
-- with a UNIQUE constraint on (operator_id, trip_date) — back when one trip
-- per day was the only possibility. With trip_id (migration 0013) those
-- constraints now actively block the feature: they stop a second same-day
-- trip from getting its own audio note, and stop the same guest being
-- recorded on two trips the same day.
--
-- Migration 0013 left them in place so the old code kept working during the
-- rollout. Drop them now that the trip_id-aware code is deployed.
--
-- IMPORTANT: apply this AFTER the new code is live in production, not before.
-- The pre-trip_id code upserts against these constraint names; dropping them
-- first breaks audio upload and guest recording until the deploy completes.
--
-- Idempotent. Paste into Supabase Dashboard -> SQL Editor -> Run.

alter table public.trip_audio
  drop constraint if exists trip_audio_operator_id_trip_date_key;

alter table public.trip_guests
  drop constraint if exists trip_guests_operator_id_email_trip_date_key;

-- The matching helper index on trip_audio is now redundant with
-- trip_audio_trip_id_key; the operator/date index stays useful for the
-- by-date booking lookups, so it is left alone.

-- ── Verify ───────────────────────────────────────────────────────────
--   select conname from pg_constraint
--    where conrelid in ('public.trip_audio'::regclass,
--                       'public.trip_guests'::regclass)
--      and contype = 'u';
--   -- expect only the trip_id-based unique indexes to remain.
