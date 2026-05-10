-- ============================================================================
-- Migration 0002 — operator branding extras + grouped species list
-- ============================================================================
-- Adds two more operator-config columns and reshapes species_list from a flat
-- array into the grouped structure the captain UI actually uses.
--
-- Idempotent. Paste into Supabase Dashboard → SQL Editor → Run.

-- ── Columns ────────────────────────────────────────────────────────

-- Logo for the email header (dark background — needs a light/white logo).
-- The existing logo_url stays — that's the dark-on-light variant used inside
-- the PDF's white circle.
ALTER TABLE operators ADD COLUMN IF NOT EXISTS logo_url_email text;

-- Footer / branding line shown on the PDF and captain card. Free text so an
-- operator can put their harbor + region or anything else.
ALTER TABLE operators ADD COLUMN IF NOT EXISTS tagline text;

-- ── Backfill the Enocean row ───────────────────────────────────────

UPDATE operators
   SET logo_url_email = 'https://trip-logger-backend.vercel.app/Public/Enocean_Tours_logo-03.png',
       tagline        = 'MOSS LANDING HARBOR, MONTEREY BAY',
       species_list   = '[
         { "group": "Whales", "species": [
             "Humpback Whale","Blue Whale","Fin Whale","Gray Whale",
             "Minke Whale","Sperm Whale"
         ]},
         { "group": "Orcas", "species": [
             "Transient Orcas","Offshore Orcas","Resident Orcas"
         ]},
         { "group": "Dolphins & Porpoises", "species": [
             "Pacific White-sided Dolphin","Northern Right Whale Dolphin",
             "Common Dolphin","Coastal Bottlenose Dolphin",
             "Dall''s Porpoise","Harbor Porpoise"
         ]},
         { "group": "Sharks", "species": [
             "White Shark","Blue Shark","Salmon Shark"
         ]},
         { "group": "Birds", "species": [
             "Black-footed Albatross"
         ]}
       ]'::jsonb
 WHERE slug = 'enocean';

-- ── Verify ─────────────────────────────────────────────────────────
--   SELECT slug, name, logo_url_email IS NOT NULL AS has_email_logo,
--          tagline, jsonb_array_length(species_list) AS species_groups
--     FROM operators WHERE slug='enocean';
