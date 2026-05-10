-- ============================================================================
-- Migration 0001 — multi-tenant schema
-- ============================================================================
-- What this does:
--   1. Creates `operators` table (one row per whale watch company)
--   2. Creates `user_profiles` table (super_admin flag on Supabase Auth users)
--   3. Creates `operator_users` table (links auth users to operators)
--   4. Adds `operator_id` to `sightings`, backfills every existing row to
--      Enocean Tours, then makes the column NOT NULL
--   5. Inserts the Enocean Tours operator with current production config
--   6. Links slatermoorephotography@gmail.com as super admin
--   7. Links enoceantours@gmail.com as the captain of Enocean Tours
--   8. Enables RLS on the three new tables (sightings RLS deferred to a later
--      step — public widget still reads via anon key today)
--
-- ----------------------------------------------------------------------------
-- DO THIS FIRST (before pasting the SQL):
--
--   In Supabase Dashboard → Authentication → Users, click "Add user" twice:
--
--     1. Email:  slatermoorephotography@gmail.com
--        Password: <your choice — save it>
--        ✓ Auto Confirm User    ← IMPORTANT, otherwise the link below fails
--
--     2. Email:  enoceantours@gmail.com
--        Password: <your choice — save it>
--        ✓ Auto Confirm User
--
--   Without "Auto Confirm User" checked, Supabase sends a confirmation email
--   and the user stays in an unconfirmed state — the linking block below
--   would skip them. Confirmed users can log in immediately.
--
-- ----------------------------------------------------------------------------
-- Then paste this entire file into Supabase Dashboard → SQL Editor → Run.
--
-- Idempotent: safe to re-run. If you create one auth user, run the SQL, then
-- create the second auth user later, just re-run — it'll fill in the missing
-- link and skip everything that was already done.
-- ============================================================================


-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- One row per operator (whale watch company). All operator-specific config
-- lives here. The Phase-2 operator UI will let operators edit the bolded
-- subset; the rest is super-admin only.

CREATE TABLE IF NOT EXISTS operators (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                     text UNIQUE NOT NULL,
  name                     text NOT NULL,

  -- ── Operator-editable ─────────────────────────────────────────
  logo_url                 text,
  review_url               text,
  species_list             jsonb DEFAULT '[]'::jsonb,
  from_email               text,
  mailchimp_api_key        text,
  mailchimp_audience_id    text,
  mailchimp_server_prefix  text DEFAULT 'us1',

  -- ── Super-admin only ──────────────────────────────────────────
  website_url              text,
  gmail_user               text,           -- SMTP username for Nodemailer
  gmail_app_password       text,           -- 16-char Gmail app password
  noaa_buoy_station        text DEFAULT '46092',
  default_map_center       text DEFAULT '36.78,-122.05',
  default_map_zoom         int  DEFAULT 10,
  fh_company_shortname     text,
  fh_app_key               text,
  fh_user_key              text,
  tripadvisor_id           text,
  google_business_id       text,

  -- ── Metadata ──────────────────────────────────────────────────
  active                   boolean DEFAULT true,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now(),

  CONSTRAINT operators_slug_lowercase CHECK (slug = lower(slug))
);

-- Profile flag layered on top of Supabase's built-in auth.users.
-- One row per auth user. Currently just tracks the super_admin flag.

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_super_admin boolean NOT NULL DEFAULT false,
  created_at     timestamptz DEFAULT now()
);

-- Links auth users to operators. Composite PK lets a single user belong to
-- multiple operators in the future (not used at v1, but cheap to allow).

CREATE TABLE IF NOT EXISTS operator_users (
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  operator_id uuid REFERENCES operators(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'owner',
  created_at  timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, operator_id),
  CONSTRAINT operator_users_role_valid CHECK (role IN ('owner','captain','viewer'))
);

CREATE INDEX IF NOT EXISTS operator_users_operator_idx ON operator_users(operator_id);

-- Add operator_id to existing sightings. Nullable while backfilling, then
-- enforced NOT NULL at the bottom of the data block.

ALTER TABLE sightings ADD COLUMN IF NOT EXISTS operator_id uuid REFERENCES operators(id);
CREATE INDEX IF NOT EXISTS sightings_operator_idx ON sightings(operator_id);


-- ============================================================================
-- 2. SEED DATA — Enocean Tours operator
-- ============================================================================
-- Lifted from the current hardcoded values in send-report.js, vercel env vars,
-- buoy-conditions.js, and index.html. Credentials (mailchimp_api_key,
-- gmail_app_password, fh_*) are intentionally left NULL — they'll be set via
-- the Phase 2 operator UI or directly in the Supabase table editor when ready.

INSERT INTO operators (
  slug, name, website_url,
  logo_url, review_url, from_email,
  gmail_user, mailchimp_audience_id, mailchimp_server_prefix,
  noaa_buoy_station, default_map_center, default_map_zoom,
  species_list
) VALUES (
  'enocean',
  'Enocean Tours',
  'https://enoceantours.com',
  'https://trip-logger-backend.vercel.app/Public/Enocean_Tours_logo-05.png',
  'https://www.enoceantours.com/reviews',
  'enoceantours@gmail.com',
  'enoceantours@gmail.com',
  '9a668398f5',
  'us1',
  '46092',
  '36.78,-122.05',
  10,
  '[
    "Humpback Whale","Blue Whale","Gray Whale","Fin Whale","Minke Whale",
    "Orca","Transient Orcas","Offshore Orcas","Resident Orcas","Sperm Whale",
    "Common Dolphin","Pacific White-sided Dolphin","Risso''s Dolphin",
    "Bottlenose Dolphin","Coastal Bottlenose Dolphin",
    "Northern Right Whale Dolphin","Harbor Porpoise","Black-footed Albatross"
  ]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- Backfill operator_id on every existing sighting (currently all Enocean).
UPDATE sightings
   SET operator_id = (SELECT id FROM operators WHERE slug = 'enocean')
 WHERE operator_id IS NULL;

-- Lock it in.
ALTER TABLE sightings ALTER COLUMN operator_id SET NOT NULL;


-- ============================================================================
-- 3. LINK AUTH USERS
-- ============================================================================
-- Looks up the auth users by email and wires them up. Skips with a NOTICE if
-- the auth user doesn't exist yet — go create them in the Dashboard first
-- (see the header), then re-run this whole file.

DO $$
DECLARE
  admin_uid   uuid;
  captain_uid uuid;
  enocean_uid uuid;
BEGIN
  SELECT id INTO admin_uid   FROM auth.users WHERE email = 'slatermoorephotography@gmail.com';
  SELECT id INTO captain_uid FROM auth.users WHERE email = 'enoceantours@gmail.com';
  SELECT id INTO enocean_uid FROM operators  WHERE slug  = 'enocean';

  IF admin_uid IS NULL THEN
    RAISE NOTICE 'auth.users row for slatermoorephotography@gmail.com NOT FOUND — create it in Dashboard → Authentication → Users (Auto Confirm checked), then re-run this migration';
  ELSE
    INSERT INTO user_profiles (user_id, is_super_admin)
      VALUES (admin_uid, true)
      ON CONFLICT (user_id) DO UPDATE SET is_super_admin = true;
    RAISE NOTICE 'super admin linked: slatermoorephotography@gmail.com';
  END IF;

  IF captain_uid IS NULL THEN
    RAISE NOTICE 'auth.users row for enoceantours@gmail.com NOT FOUND — create it in Dashboard → Authentication → Users (Auto Confirm checked), then re-run this migration';
  ELSE
    INSERT INTO user_profiles (user_id, is_super_admin)
      VALUES (captain_uid, false)
      ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO operator_users (user_id, operator_id, role)
      VALUES (captain_uid, enocean_uid, 'owner')
      ON CONFLICT (user_id, operator_id) DO NOTHING;
    RAISE NOTICE 'captain linked: enoceantours@gmail.com → Enocean Tours';
  END IF;
END $$;


-- ============================================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================================
-- operators / user_profiles / operator_users hold credentials and identity
-- info — RLS on, anon role gets nothing.
--
-- sightings RLS is intentionally NOT enabled here. The public sightings widget
-- currently reads the table via the anon key, and this step doesn't change the
-- widget yet. We'll lock down sightings with per-operator policies in a later
-- step when the widget URL becomes per-operator (e.g., /widget/enocean).
--
-- Server-side code that uses SUPABASE_SECRET_KEY (the service role) bypasses
-- RLS unconditionally, so send-report.js and the rest of the API keep working
-- exactly as before.

ALTER TABLE operators       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_users  ENABLE ROW LEVEL SECURITY;

-- ── operators ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "operators_select" ON operators;
CREATE POLICY "operators_select" ON operators FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM operator_users
       WHERE operator_users.user_id = auth.uid()
         AND operator_users.operator_id = operators.id
    )
    OR EXISTS (
      SELECT 1 FROM user_profiles
       WHERE user_profiles.user_id = auth.uid()
         AND user_profiles.is_super_admin = true
    )
  );

DROP POLICY IF EXISTS "operators_update" ON operators;
CREATE POLICY "operators_update" ON operators FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM operator_users
       WHERE operator_users.user_id = auth.uid()
         AND operator_users.operator_id = operators.id
    )
    OR EXISTS (
      SELECT 1 FROM user_profiles
       WHERE user_profiles.user_id = auth.uid()
         AND user_profiles.is_super_admin = true
    )
  );

DROP POLICY IF EXISTS "operators_admin_insert" ON operators;
CREATE POLICY "operators_admin_insert" ON operators FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
       WHERE user_profiles.user_id = auth.uid()
         AND user_profiles.is_super_admin = true
    )
  );

DROP POLICY IF EXISTS "operators_admin_delete" ON operators;
CREATE POLICY "operators_admin_delete" ON operators FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
       WHERE user_profiles.user_id = auth.uid()
         AND user_profiles.is_super_admin = true
    )
  );

-- ── user_profiles ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "user_profiles_select_own" ON user_profiles;
CREATE POLICY "user_profiles_select_own" ON user_profiles FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles up
       WHERE up.user_id = auth.uid()
         AND up.is_super_admin = true
    )
  );

-- ── operator_users ────────────────────────────────────────────────

DROP POLICY IF EXISTS "operator_users_select" ON operator_users;
CREATE POLICY "operator_users_select" ON operator_users FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles
       WHERE user_profiles.user_id = auth.uid()
         AND user_profiles.is_super_admin = true
    )
  );


-- ============================================================================
-- DONE. Quick verifications:
--
--   -- Should return one row, slug='enocean'
--   SELECT slug, name FROM operators;
--
--   -- Should return both emails with is_super_admin true/false respectively
--   SELECT u.email, p.is_super_admin
--     FROM auth.users u
--     LEFT JOIN user_profiles p ON p.user_id = u.id
--    WHERE u.email IN ('slatermoorephotography@gmail.com','enoceantours@gmail.com');
--
--   -- Should return 0 — every sighting now has an operator_id
--   SELECT count(*) FROM sightings WHERE operator_id IS NULL;
--
--   -- Should return one row linking enoceantours@gmail.com to Enocean
--   SELECT u.email, o.name, ou.role
--     FROM operator_users ou
--     JOIN auth.users u ON u.id = ou.user_id
--     JOIN operators o  ON o.id = ou.operator_id;
-- ============================================================================
