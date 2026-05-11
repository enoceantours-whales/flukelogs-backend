-- 0007_silence_advisors.sql
-- Resolves Supabase security advisor warnings flagged on 2026-05-11.
-- All three are pre-existing — no API behavior change.

-- bookings: only the service role reads/writes (FareHarbor webhook +
-- admin endpoints since 0006). Add an explicit deny-all policy for
-- non-service roles so the "RLS enabled with no policies" advisor stops
-- warning. The service role bypasses RLS, so this is a no-op for the
-- existing API surface — anon/authenticated roles already had no access.
CREATE POLICY no_access ON public.bookings FOR ALL TO public USING (false);

-- trip_guests: same situation since 0004 — service-role-only writes/reads.
CREATE POLICY no_access ON public.trip_guests FOR ALL TO public USING (false);

-- guest_stats: pin search_path so the function's implicit table lookups
-- can't be redirected by the caller's session search_path. Set to 'public'
-- (not '') because the function body uses unqualified table names —
-- rewriting those is overkill when fixing the search_path resolves the
-- lint warning by itself.
ALTER FUNCTION public.guest_stats(uuid, text) SET search_path = 'public';
