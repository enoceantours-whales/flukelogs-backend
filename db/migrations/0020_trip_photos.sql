-- ============================================================================
-- Migration 0020 - trip_photos (per-trip photo gallery)
-- ============================================================================
-- Captains can attach a gallery of photos to a trip (added later by reopening a
-- past trip, in the same per-trip media screen as the voice note). The public
-- sightings widget shows a hero image plus a count badge that opens the gallery.
--
-- Mirrors the trip_audio design, but follows the POST-0018 security posture:
-- RLS is ENABLED with NO anon read policy. The public widget never reads this
-- table directly; it goes through the service-role /api/widget-data endpoint,
-- exactly like sightings and trip_audio do now. So there is no cross-operator
-- leak and no USING (true) policy is created here.
--
-- Photo files live in a separate public storage bucket `trip-photos`, uploaded
-- by /api/trip-photos with the service role (the bucket row is created
-- separately, like the trip-audio bucket). Public bucket = readable by URL on
-- the widget; we intentionally do NOT add a LIST policy so filenames are not
-- enumerable.
--
-- Rollback: DROP TABLE trip_photos;  (and remove the storage bucket if desired)

CREATE TABLE IF NOT EXISTS trip_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  trip_id     uuid NOT NULL,
  trip_date   date NOT NULL,
  photo_url   text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_photos_operator_trip
  ON trip_photos (operator_id, trip_id);

ALTER TABLE trip_photos ENABLE ROW LEVEL SECURITY;

-- Intentionally no SELECT/INSERT policy for anon or authenticated. All access is
-- via the service role (server endpoints), which bypasses RLS. This matches the
-- locked-down posture established in migration 0018.
