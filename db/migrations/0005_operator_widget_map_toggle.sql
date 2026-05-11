-- Public sightings widget: per-operator toggle for showing the map.
-- Some operators do not want to share GPS coordinates of where whales were
-- found. When false, the widget hides the Leaflet map and still renders the
-- per-trip species tally feed + audio recap.

alter table public.operators
  add column if not exists show_map_on_widget boolean not null default true;

comment on column public.operators.show_map_on_widget is
  'Whether the public sightings widget renders the Leaflet map. Some operators do not want to share the GPS locations of sightings.';
