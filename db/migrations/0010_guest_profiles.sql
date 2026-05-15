-- 0010_guest_profiles.sql
-- Phase 1 of customer-facing profiles. Guests sign in to /profile via a
-- Supabase magic link, fill out first_name / last_name / bio, then see
-- "My Trips" — every (operator_id, trip_date) we've already emailed
-- them, plus the sightings logged that day.
--
-- A guest is just a regular auth.users row PLUS a row here. The existing
-- public.user_profiles table is for operator staff (is_super_admin flag),
-- so we keep guests on their own table to preserve that distinction.
-- A single auth user can in theory be BOTH (own a tour company AND book
-- a trip on someone else's) — that's intentional, two profile rows.
--
-- Already applied to production as Supabase migration `0007_guest_profiles`
-- on 2026-05-15 — checked in here for fresh-setup parity.

CREATE TABLE public.guest_profiles (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text NOT NULL,
  first_name  text,
  last_name   text,
  bio         text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX guest_profiles_email_lower_idx
  ON public.guest_profiles (lower(email));

-- ── Wire historic and future trip_guests rows to a guest ──────────
-- trip_guests was always keyed by email (see migration 0004). The
-- guest_id column lets a logged-in guest pull their trips with a
-- single indexed equality check instead of a case-insensitive email
-- join, and survives the user changing emails later.

ALTER TABLE public.trip_guests
  ADD COLUMN guest_id uuid REFERENCES public.guest_profiles(user_id) ON DELETE SET NULL;

CREATE INDEX trip_guests_guest_id_idx ON public.trip_guests(guest_id);
CREATE INDEX trip_guests_email_lower_idx ON public.trip_guests(lower(email));

-- ── updated_at trigger ────────────────────────────────────────────
-- Plain helper; reused by future tables. search_path is locked so a
-- compromised role can't shadow `now()` from another schema.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END $$;

CREATE TRIGGER guest_profiles_set_updated_at
  BEFORE UPDATE ON public.guest_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Backfill historic trips on first signup ───────────────────────
-- Fires once per profile creation. SECURITY DEFINER so the trigger
-- can update trip_guests even though the inserting role (authenticated
-- via the guest's JWT) wouldn't normally have UPDATE permission on
-- that table.

CREATE OR REPLACE FUNCTION public.backfill_trip_guests_on_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.trip_guests
     SET guest_id = new.user_id
   WHERE lower(email) = lower(new.email)
     AND guest_id IS NULL;
  RETURN new;
END $$;

CREATE TRIGGER guest_profiles_backfill_trip_guests
  AFTER INSERT ON public.guest_profiles
  FOR EACH ROW EXECUTE FUNCTION public.backfill_trip_guests_on_profile();

-- ── Auto-link future trip_guests inserts ──────────────────────────
-- send-report.js inserts trip_guests rows server-side (service role)
-- whenever a trip email goes out. This trigger looks up an existing
-- guest by email at insert time so the row is born already linked,
-- without having to wait for backfill on the next signup.

CREATE OR REPLACE FUNCTION public.link_trip_guest_to_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new.guest_id IS NULL THEN
    SELECT user_id INTO new.guest_id
      FROM public.guest_profiles
     WHERE lower(email) = lower(new.email)
     LIMIT 1;
  END IF;
  RETURN new;
END $$;

CREATE TRIGGER trip_guests_link_profile
  BEFORE INSERT ON public.trip_guests
  FOR EACH ROW EXECUTE FUNCTION public.link_trip_guest_to_profile();

-- ── RLS: a guest sees only their own profile ──────────────────────
-- INSERT/UPDATE policies use auth.uid() = user_id so a logged-in
-- guest can write their own row over PostgREST without service-role
-- credentials. The server-side upsert in /api/guest/profile uses
-- service role for symmetry with the rest of the codebase, but the
-- policies are still here in case a future client writes direct.

ALTER TABLE public.guest_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY guest_profiles_select_own
  ON public.guest_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY guest_profiles_insert_own
  ON public.guest_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY guest_profiles_update_own
  ON public.guest_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── RLS: trip_guests select for the guest themselves ──────────────
-- Existing staff-side policies are untouched. The link trigger above
-- guarantees guest_id is populated for any row matching the guest's
-- email, so the equality check covers historic and future trips.

CREATE POLICY trip_guests_select_own_guest
  ON public.trip_guests FOR SELECT
  USING (guest_id = auth.uid());

-- ── RLS: sightings for trips the guest attended ───────────────────
-- A guest can read a sightings row only when there's a matching
-- trip_guests row for them at the same (operator_id, trip_date).
-- INSERT/UPDATE/DELETE remain limited to operator staff.

CREATE POLICY sightings_select_own_trips_guest
  ON public.sightings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.trip_guests tg
       WHERE tg.operator_id = sightings.operator_id
         AND tg.trip_date  = sightings.trip_date
         AND tg.guest_id   = auth.uid()
    )
  );
