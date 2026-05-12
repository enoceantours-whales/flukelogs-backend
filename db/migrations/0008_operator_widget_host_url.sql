-- 0008_operator_widget_host_url.sql
-- Per-operator "where does the widget live on your site" URL.
-- Used by the in-widget share button so a shared trip link lands on the
-- operator's branded page (with their site chrome, their Book Now CTA,
-- and SEO juice flowing to their domain) instead of the bare vercel.app
-- widget URL.
--
-- When null, the widget falls back to its existing behaviour of sharing
-- the /api/sightings URL on our domain. Backfilled for Enocean inline
-- so the share button starts pointing at enoceantours.com immediately.

ALTER TABLE public.operators
  ADD COLUMN widget_host_url text;

COMMENT ON COLUMN public.operators.widget_host_url IS
  'Public URL of the page on the operator''s site where the sightings widget is embedded. In-widget share buttons send recipients here with ?trip=YYYY-MM-DD appended.';

UPDATE public.operators
  SET widget_host_url = 'https://enoceantours.com/sighting-log'
WHERE slug = 'enocean';
