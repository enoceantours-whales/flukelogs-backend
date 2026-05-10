-- ============================================================================
-- Migration 0003 — captain audio notes per trip date
-- ============================================================================
-- One audio note per (operator, trip_date). The captain records it after the
-- fact (in their car / at home — anywhere private), and the public sightings
-- widget shows a player on the matching trip card.
--
-- Keyed on date rather than a trip id because the widget already groups
-- sightings by date — multi-trip days share one audio note, which matches
-- how the widget renders them anyway.
--
-- Idempotent. Paste into Supabase Dashboard → SQL Editor → Run.
--
-- ALSO REQUIRED (one-time, in Supabase Dashboard):
--   Storage → New bucket → name `trip-audio` → toggle Public ON → Create.

CREATE TABLE IF NOT EXISTS trip_audio (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      uuid NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  trip_date        date NOT NULL,
  audio_url        text NOT NULL,
  duration_seconds integer,
  content_type     text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (operator_id, trip_date)
);

CREATE INDEX IF NOT EXISTS trip_audio_operator_date_idx
  ON trip_audio(operator_id, trip_date);

-- Public widget reads this table via the anon key. Writes happen through
-- the server endpoint with the service role.
ALTER TABLE trip_audio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trip_audio_public_read" ON trip_audio;
CREATE POLICY "trip_audio_public_read" ON trip_audio FOR SELECT USING (true);

-- ── Verify ─────────────────────────────────────────────────────────
--   SELECT count(*) FROM trip_audio;  -- expect 0
