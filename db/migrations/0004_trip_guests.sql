-- ============================================================================
-- Migration 0004 — per-guest whale log
-- ============================================================================
-- Records who was emailed on which trip so the next email can say
--   "Welcome back — your 3rd trip with us. You've now spotted 8 species…"
-- instead of generic "Hi there".
--
-- Email is stored lowercased so case differences ("Sarah@" vs "sarah@") still
-- match. UNIQUE on (operator_id, email, trip_date) means re-sending the same
-- trip report doesn't double-count.
--
-- Idempotent. Paste into Supabase Dashboard → SQL Editor → Run.

CREATE TABLE IF NOT EXISTS trip_guests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  trip_date   date NOT NULL,
  email       text NOT NULL,                    -- always stored lowercased
  created_at  timestamptz DEFAULT now(),
  UNIQUE (operator_id, email, trip_date)
);

CREATE INDEX IF NOT EXISTS trip_guests_op_email_idx
  ON trip_guests (operator_id, email);

-- Server-only access via service role; no anon read.
ALTER TABLE trip_guests ENABLE ROW LEVEL SECURITY;

-- Counts how many trips an email has been on for an operator (including
-- today, if today's row has been inserted) and how many distinct species
-- they've now seen across all those trips.
--
-- Called from /api/send-report after recordGuestsForTrip inserts the
-- current trip's row, so a 1st-timer returns trips=1 and a 2nd-trip
-- returns trips=2.
CREATE OR REPLACE FUNCTION public.guest_stats(op_id uuid, email_in text)
RETURNS TABLE(trips int, species int) AS $$
  WITH dates AS (
    SELECT DISTINCT trip_date
      FROM trip_guests
     WHERE operator_id = op_id
       AND email       = lower(email_in)
  )
  SELECT
    (SELECT count(*)::int FROM dates),
    COALESCE(
      (SELECT count(DISTINCT species)::int
         FROM sightings
        WHERE operator_id = op_id
          AND trip_date IN (SELECT trip_date FROM dates)),
      0);
$$ LANGUAGE sql STABLE;

-- ── Verify ─────────────────────────────────────────────────────────
--   SELECT * FROM guest_stats('<some-operator-uuid>', 'test@example.com');
--   -- New email -> (0, 0). After a few trips inserted, climbs.
