-- 0011_lock_down_guest_profile_functions.sql
-- Follow-up to 0010 to clear three security-advisor warnings:
--
--   1. `set_updated_at` was created without `SET search_path` in the
--      original migration. Pin it now so a compromised role can't
--      shadow now() / public schema lookups inside the trigger.
--
--   2-3. `backfill_trip_guests_on_profile` and `link_trip_guest_to_profile`
--      are SECURITY DEFINER, which means PostgREST exposes them as RPC
--      endpoints any anon/authenticated user can call. They're only
--      meant to fire from triggers, so we revoke EXECUTE from public,
--      anon, and authenticated. Triggers still work — the table owner
--      executes them regardless of EXECUTE grants.
--
-- Already applied to production as Supabase migration
-- `0008_lock_down_guest_profile_functions` on 2026-05-15.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END $$;

REVOKE EXECUTE ON FUNCTION public.backfill_trip_guests_on_profile()
  FROM public, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.link_trip_guest_to_profile()
  FROM public, anon, authenticated;
