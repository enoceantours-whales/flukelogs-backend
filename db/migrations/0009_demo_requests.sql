-- 0009_demo_requests.sql
-- Inbound demo requests from the public /landing page form. Captured
-- here (instead of mailto-only) so prospects don't slip through email
-- filters and Slater has a single auditable place to triage outreach
-- from. Service-role-only — anon never touches this table; the public
-- /api/demo-request endpoint inserts on the captor's behalf.

CREATE TABLE public.demo_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text NOT NULL,
  company     text,
  website     text,
  message     text,
  source      text,                 -- e.g. 'landing-page'; tag for future channels
  user_agent  text,                 -- diagnostic-only, helps if a form submission misbehaves
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX demo_requests_created_at_idx ON public.demo_requests (created_at DESC);

ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;

-- Same pattern as bookings / trip_guests — RLS enabled with an explicit
-- deny-all so the advisor stops warning, while the service-role key
-- (used by /api/demo-request) bypasses RLS for the insert.
CREATE POLICY no_access ON public.demo_requests FOR ALL TO public USING (false);
