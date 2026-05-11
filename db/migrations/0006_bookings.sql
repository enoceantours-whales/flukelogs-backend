-- ============================================================================
-- Migration 0006 — FareHarbor bookings
-- ============================================================================
-- One row per FareHarbor booking. Captured from FH's outgoing webhook into
-- /api/fh-webhook. Webhook fires on new + updated booking events, so the
-- handler upserts on (operator_id, fh_uuid) — same booking edited later
-- updates in place.
--
-- The captain's trip-start screen reads this table by trip_date to pre-fill
-- passenger count and booker emails for the day's trip(s). availability_pk
-- groups bookings into individual trip slots (e.g. 9am vs 1pm on the same
-- date) so we can render a slot picker when more than one slot has bookings.
--
-- raw (jsonb) holds the full FH payload so we can backfill new columns later
-- without re-requesting from FH.
--
-- Server-only access (RLS on, no anon policies). Service role bypasses RLS.
--
-- Idempotent. Paste into Supabase Dashboard → SQL Editor → Run.

CREATE TABLE IF NOT EXISTS bookings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         uuid NOT NULL REFERENCES operators(id) ON DELETE CASCADE,

  -- FareHarbor identifiers
  fh_uuid             uuid NOT NULL,                    -- booking.uuid (dedupe key)
  fh_pk               bigint NOT NULL,                  -- booking.pk
  fh_display_id       text,                             -- "#348358650"

  -- lifecycle
  status              text NOT NULL,                    -- 'booked' | 'cancelled' | ...

  -- trip-day grouping (date in operator local TZ, derived from start_at prefix)
  trip_date           date NOT NULL,
  start_at            timestamptz NOT NULL,
  end_at              timestamptz,

  -- which trip slot this booking is for
  availability_pk     bigint,                           -- groups same-slot bookings
  item_pk             bigint,
  item_name           text,                             -- e.g. "3hr Whale Watch"

  -- booker (one per booking, NOT per passenger)
  contact_name        text,
  contact_email       text,                             -- lowercased
  contact_phone       text,

  -- party size
  customer_count      int NOT NULL DEFAULT 1,

  -- money (FH sends in cents)
  receipt_total_cents int,
  amount_paid_cents   int,

  -- attribution
  heard_about_us      text,                             -- resolved display_value

  -- full raw payload (audit + future fields)
  raw                 jsonb NOT NULL,

  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),

  UNIQUE (operator_id, fh_uuid)
);

CREATE INDEX IF NOT EXISTS bookings_operator_trip_date_idx
  ON bookings (operator_id, trip_date);

CREATE INDEX IF NOT EXISTS bookings_operator_availability_idx
  ON bookings (operator_id, availability_pk);

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- ── Verify ─────────────────────────────────────────────────────────
--   SELECT trip_date, item_name, COUNT(*) AS bookings, SUM(customer_count) AS pax
--     FROM bookings
--    WHERE operator_id = (SELECT id FROM operators WHERE slug='enocean')
--    GROUP BY trip_date, item_name
--    ORDER BY trip_date DESC;
