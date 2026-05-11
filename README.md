# Enocean Tours — Trip Logger

A mobile-first Progressive Web App (PWA) for logging whale-watch trips, delivering branded trip reports to guests, and displaying a live public sightings log on the operator's website.

Built and operated by Slater Moore, Captain — [enoceantours.com](https://enoceantours.com). The codebase is **multi-tenant** — Enocean Tours is the first operator on it, but the schema, auth, and admin tooling are all designed to onboard additional whale-watch companies as a white-label SaaS.

---

## What It Does

1. Guest books a trip on FareHarbor → FH fires a webhook to the app → the booking is saved to Supabase tagged with the operator
2. Captain opens the app on trip morning — the day's bookings appear as a slot picker on the start screen (one slot auto-applies, multiple slots become tappable cards), passenger count pre-fills, booker emails are staged
3. Captain starts the trip, conditions (water temp + sea state) auto-fill from a NOAA buoy
4. GPS tracks position and calculates nautical miles traveled
5. Captain logs each wildlife sighting (species, count, time, GPS coordinates, notes)
6. At trip end, captain uploads a group photo and confirms the staged guest emails (adding any additional passengers as needed)
7. App generates and emails each guest:
   - A one-page branded **PDF trip report** (photo, map, sightings log, depth at each pin)
   - A **1080×1920 Story card JPG** ready to post on Instagram
8. Ocean depth at each sighting is looked up from NOAA's bathymetric DEM and saved with the row
9. Trip sightings are saved to Supabase, tagged with the operator
10. Guests are added to the operator's Mailchimp audience
11. Email opens with a **personalized greeting** based on the guest's history — first-timer gets a "welcome aboard your first trip" line; returning guests see *"Welcome back — your 3rd trip with us. You've now spotted 8 species across all your trips."*
12. Email includes a direct link to leave a review
13. Captain receives a separate **captain-copy IG card** in their own inbox to post manually
14. **After the trip** (privately, when there are no guests around) the captain can record a short audio recap for any trip date — it shows up as a player on the public sightings widget
15. Public sightings widget on the operator's website updates automatically after every trip

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS — PWA with Service Worker + localStorage |
| Auth | Supabase Auth (email + password, invite-only) |
| Backend | Node.js Serverless Functions on Vercel |
| Database | Supabase (PostgreSQL) with Row Level Security on sensitive tables |
| File Storage | Supabase Storage (public buckets for logos and audio) |
| PDF Generation | PDFKit |
| Story / Captain Cards | Browser Canvas API |
| Audio Recording | MediaRecorder API |
| Trip Report Map | Google Static Maps API |
| Sightings Widget Map | Leaflet + ESRI Ocean Basemap |
| Bathymetry | NOAA NCEI global DEM mosaic (per-sighting depth lookup) |
| Sea Conditions | NOAA NDBC realtime2 buoy feed |
| Email | Gmail SMTP via Nodemailer |
| CRM | Mailchimp Marketing API |
| Bookings | FareHarbor outgoing webhooks (Bookings-only schema) |
| Hosting | Vercel (Pro plan) |
| Repo | GitHub — enoceantours-whales/trip-logger-backend |

---

## Architecture — Multi-tenant

Every meaningful piece of operator-specific data is stored on a row in the `operators` table — branding, credentials, species list, buoy station, map defaults, booking-platform keys, etc. The PWA reads its config via `/api/me` after login; the server reads it from the DB on every send. **Adding a new whale-watch operator is just data, not code.**

### Roles

- **Operator** (`operator_users.role = 'owner'`): a captain account tied to a single operator. Can use the trip-logger end-to-end and edit the operator-editable subset of their own settings (logo, review URL, species list, "from" email, Mailchimp credentials, public-widget map toggle).
- **Super admin** (`user_profiles.is_super_admin = true`): can list / create / edit / delete any operator from the in-app Admin portal, including super-admin-only fields (Gmail SMTP credentials, NOAA buoy station, FareHarbor keys, name, slug, active flag).

### Isolation

- Sightings and bookings both carry `operator_id`. The trip-end flow refuses to write a sighting row without a verified operator id from the JWT; the FareHarbor webhook resolves the operator from `booking.company.shortname` against `operators.fh_company_shortname` and silently drops the payload if no operator matches.
- Operator credentials live behind RLS — only the service-role server endpoints read them, and only after `authenticate()` resolves the operator from the bearer token.
- The `/api/me` and `/api/operator-settings` responses scrub secrets before they ever reach the browser (Mailchimp keys, Gmail passwords, FareHarbor keys come back as `has_X: true|false`).

---

## Project Structure

```
trip-logger-backend/
├── db/
│   └── migrations/                       # Hand-applied SQL via Supabase SQL Editor
│       ├── 0001_init_multi_tenant.sql
│       ├── 0002_operator_branding_extras.sql
│       ├── 0003_trip_audio.sql
│       ├── 0004_trip_guests.sql
│       ├── 0005_operator_widget_map_toggle.sql
│       └── 0006_bookings.sql
├── trip-logger/
│   ├── api/
│   │   ├── admin/
│   │   │   ├── operators.js              # super admin: list / create
│   │   │   └── operators/[id].js         # super admin: get / update / delete
│   │   ├── operator/
│   │   │   ├── bookings.js               # GET — FareHarbor bookings for a trip_date, grouped by slot
│   │   │   └── trips.js                  # GET — operator's recent trip dates
│   │   ├── buoy-conditions.js            # NOAA NDBC realtime2 proxy
│   │   ├── fh-webhook.js                 # FareHarbor outgoing webhook receiver — upserts bookings
│   │   ├── me.js                         # GET — current user + operator config
│   │   ├── operator-logo-upload.js       # POST — upload PNG to Supabase Storage
│   │   ├── operator-settings.js          # GET / PATCH — operator-editable settings
│   │   ├── send-report.js                # PDF + email + Supabase save + captain copy
│   │   ├── sightings-widget.html         # public widget (HTML + JS, served as-is)
│   │   ├── sightings.js                  # serves sightings-widget.html with CORS
│   │   ├── static-map.js                 # Google Static Maps proxy (server-side key)
│   │   └── trip-audio.js                 # POST upload audio + upsert / DELETE remove
│   ├── lib/
│   │   ├── auth.js                       # JWT verify + role/operator resolution
│   │   └── operators.js                  # operator-row fetch + sanitization helpers
│   ├── Public/
│   │   ├── Enocean_Tours_logo-03.png     # white logo (email header default)
│   │   ├── Enocean_Tours_logo-05.png     # black logo (PDF white-circle default)
│   │   ├── manifest.json                 # PWA manifest
│   │   └── sw.js                         # service worker
│   ├── env.example
│   ├── index.html                        # PWA SPA — login, log, settings, admin, past trips
│   └── package.json
├── README.md
└── vercel.json                           # routing
```

---

## Features

### Auth + Settings UI
- Login screen on the PWA (Supabase Auth, email + password)
- Sessions persist across reloads; auto-refresh
- Operator-facing **Settings** screen for editable fields (logo URLs with file upload, review URL, "from" email, Mailchimp credentials, species list)
- Super admin **Admin** portal for full CRUD on any operator (every column, including credentials)

### Trip Logging
- Species dropdown rendered from `operators.species_list` (jsonb) — fully per-operator
- Count, time, optional behavior notes per sighting
- GPS coordinates auto-captured per sighting
- Live nautical miles counter (Haversine formula)
- Trip duration timer
- Water temp + sea state pre-filled from the operator's NOAA buoy on the start screen

### FareHarbor Booking Pre-Fill
- FareHarbor fires an outgoing webhook at `/api/fh-webhook` on every booking event (new + updated). The handler resolves the operator from `booking.company.shortname`, derives `trip_date` from the booking's local-offset start time, and upserts into `bookings` keyed on `(operator_id, fh_uuid)` so the same booking edited later updates in place.
- On the trip-start screen, the PWA fetches `/api/operator/bookings?trip_date=<today>` and renders a smart slot picker above the passenger stepper:
  - **0 slots** — picker hidden; form behaves exactly as before
  - **1 slot** — auto-applied as a read-only card (e.g. `9:00 AM · 3hr Whale Watch · 4 guests`)
  - **2+ slots** — tappable cards; captain picks which trip they're about to run (handles multi-trip days)
- Selecting a slot sets the passenger count and stages the booker emails (deduped) into the existing `guestEmails` array, so they appear pre-loaded on the trip-end review screen. Captain can still adjust everything manually.
- Cancelled bookings are filtered out of the read endpoint; the row is kept in `bookings` for audit. The raw FH payload is stored as `jsonb` on every row so new columns can be backfilled later without re-requesting from FH.

### PDF Report (single page)
- Black header with logo
- Group photo full bleed
- Stats: date, duration, distance, passengers, sightings
- Conditions bar: visibility, sea state, water temp
- Full-width satellite map (operator's default center / zoom)
- White numbered pins for each sighting location
- Sightings table: species, count, time, notes + coordinates inline, plus ocean depth at each pin
- Auto-scales font size to fit any number of sightings on one page
- Branded footer using `operator.name`, `operator.tagline`, and `operator.website_url`

### Story Card (1080×1920 JPG, sent to guests)
- Guest photo full bleed background
- Dark gradient overlay
- "TODAY WE SAW" with species list
- Per-operator branding (name, tagline, website host)

### Captain Card (1080×1920 JPG, captain-only inbox)
- PDF-styled IG-ready image emailed only to the operator's `from_email`
- Logo + map with numbered pins + stats + tallied sightings list
- Designed inside Instagram Story safe zones
- Captain downloads from email and posts to IG manually

### Captain Audio Notes
- "Past Trips" screen lists recent trip dates
- Tap a date → focused recorder (private — captain records in the car / at home)
- MediaRecorder-based, 3-min hard cap, preview before save
- Saved audio appears as a small player on the corresponding trip card in the public sightings widget

### Email
- Black/white branded HTML email
- Logo, stats, species summary
- **Per-guest personalized greeting** — first-timers get *"welcome aboard your first trip"*; returning guests see *"Welcome back — your Nth trip with us. You've now spotted X species across all your trips."* Same PDF/Story card attached for everyone — only the opening line changes per recipient.
- "LEAVE US A REVIEW" CTA (operator-configurable URL)
- PDF + Story card attached
- Guest auto-added to the operator's Mailchimp audience with a "Trip Guest" tag

### PWA
- Add to home screen on iPhone — works like a native app
- Service worker caches the app shell for offline use
- localStorage saves trip state — survives mid-trip refresh

### Public Sightings Widget
- Live at e.g. [enoceantours.com/sighting-log](https://enoceantours.com/sighting-log)
- Served via `/api/sightings` — embedded in Squarespace via iframe
- Interactive Leaflet map with ESRI Ocean Basemap showing Monterey Submarine Canyon bathymetry
- Color-coded species markers — click any marker for species, count, and ocean depth at that pin
- Trip log grouped by date — one card per trip, tallied by species
- **Captain audio player** on trip cards that have audio — pill-shaped, custom waveform visualization (36 deterministic bars seeded from the audio URL), click-to-seek, auto-pauses other players when one starts. No native HTML5 controls.
- Click a trip date header to pan the map to all sightings that day
- Click a species row to pan to that specific sighting
- Season totals bar — running whale and dolphin counts
- Auto-resizes iframe height as trips accumulate

---

## Database Schema

### `operators`
One row per whale-watch company. Mix of operator-editable and super-admin-only fields.

| Column | Type | Editable by | Notes |
|---|---|---|---|
| `id`, `slug`, `name`, `active`, `created_at`, `updated_at` | — | super admin | identity |
| `logo_url`, `logo_url_email`, `review_url`, `species_list` (jsonb), `from_email`, `mailchimp_*`, `show_map_on_widget` | — | operator | what the captain controls in Settings |
| `tagline`, `website_url`, `gmail_user`, `gmail_app_password`, `noaa_buoy_station`, `default_map_center`, `default_map_zoom`, `fh_*`, `tripadvisor_id`, `google_business_id` | — | super admin | infrastructure / external IDs |

### `user_profiles`
| Column | Type | Description |
|---|---|---|
| `user_id` | uuid (FK → `auth.users.id`) | Supabase Auth user id |
| `is_super_admin` | boolean | gate for the Admin portal + admin endpoints |

### `operator_users`
Links auth users to operators. Composite PK `(user_id, operator_id)` allows one user to belong to multiple operators in the future.

| Column | Type | Description |
|---|---|---|
| `user_id` | uuid (FK) | Supabase Auth user |
| `operator_id` | uuid (FK) | the operator |
| `role` | text | `owner` / `captain` / `viewer` (only `owner` used today) |

### `sightings`
Per-species row inside a trip. Tagged with `operator_id` since migration 0001.

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Auto-generated |
| `operator_id` | uuid (FK) | Owning operator |
| `trip_date` | date | Date of trip |
| `species` | text | Species name |
| `count` | int | Number of individuals |
| `lat`, `lng` | numeric | GPS coordinates |
| `duration_minutes`, `distance_nm`, `passengers` | numeric/int | Trip-level stats (denormalized on every row) |
| `water_temp`, `visibility`, `conditions` | text | Trip-level conditions |
| `behavior_notes` | text | Optional notes |
| `depth_meters` | numeric | Ocean depth at sighting; null if on land or lookup failed |
| `created_at` | timestamptz | Auto-generated |

### `trip_audio`
Per-date captain audio note. One row per `(operator_id, trip_date)`. Public read via the anon key (the widget reads it).

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Auto-generated |
| `operator_id` | uuid (FK) | Owning operator |
| `trip_date` | date | Trip date the audio belongs to |
| `audio_url` | text | Public URL inside the `trip-audio` Supabase bucket |
| `duration_seconds` | int | Optional; rendered next to the player title |
| `content_type` | text | `audio/mp4`, `audio/webm`, etc. |
| `created_at`, `updated_at` | timestamptz | Auto-generated |

### `trip_guests`
One row per guest per trip — used to power the personalized greeting in the trip-end email. Server-only access (RLS on, no anon).

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Auto-generated |
| `operator_id` | uuid (FK) | Owning operator |
| `trip_date` | date | Trip date the guest was on |
| `email` | text | Always stored lowercased so case differences still match |
| `created_at` | timestamptz | When the row was inserted |

UNIQUE on `(operator_id, email, trip_date)` — re-sending the same trip is idempotent.

Backed by a `guest_stats(op_id, email_in)` PL/SQL function that returns `{trips, species}` — counts the guest's distinct trip dates and total distinct species across all those trips. Called from `send-report.js` to choose between first-timer and returning-guest copy.

### `bookings`
One row per FareHarbor booking. Captured from FH's outgoing webhook into `/api/fh-webhook`. The webhook fires on new + updated booking events, so the handler upserts on `(operator_id, fh_uuid)` — the same booking edited later updates in place. The captain's trip-start screen reads this table by `trip_date` to pre-fill passenger count and booker emails for the day's trip(s). Server-only access (RLS on, no anon policies).

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Auto-generated |
| `operator_id` | uuid (FK) | Owning operator |
| `fh_uuid` | uuid | FareHarbor's booking UUID — the dedupe key |
| `fh_pk` | bigint | FareHarbor's internal booking pk |
| `fh_display_id` | text | Human-readable id, e.g. `"#348358650"` |
| `status` | text | `booked` / `cancelled` / … (cancelled rows are filtered out of the read endpoint but kept for audit) |
| `trip_date` | date | Date in operator local TZ, derived from `availability.start_at`'s offset prefix |
| `start_at`, `end_at` | timestamptz | Exact slot times |
| `availability_pk` | bigint | Groups same-slot bookings (e.g. 9am vs 1pm on the same date) |
| `item_pk`, `item_name` | bigint / text | The product, e.g. `"3hr Whale Watch"` |
| `contact_name`, `contact_email`, `contact_phone` | text | The booker (one per booking, **not** per passenger). `contact_email` is stored lowercased |
| `customer_count` | int | Party size — what the trip-start screen uses to set the passenger stepper |
| `receipt_total_cents`, `amount_paid_cents` | int | FH sends amounts in cents |
| `heard_about_us` | text | Resolved `display_value` for the "How did you hear about us?" custom field |
| `raw` | jsonb | Full FH payload — preserves data for future backfills without re-requesting from FH |
| `created_at`, `updated_at` | timestamptz | Auto-generated |

UNIQUE on `(operator_id, fh_uuid)`. Indexed on `(operator_id, trip_date)` for the captain's pre-fill query and on `(operator_id, availability_pk)` for slot grouping.

---

## Environment Variables

Set in Vercel → Settings → Environment Variables. With Step 4+ shipped, **most operator-specific values now live on the `operators` row** — these env vars are fall-back defaults only, used when a column is null.

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Supabase service-role key (never expose client-side) |
| `GOOGLE_MAPS_API_KEY` | Google Static Maps API key (shared, server-side only) |
| `MAILCHIMP_API_KEY` | Fallback Mailchimp API key (operator row preferred) |
| `MAILCHIMP_AUDIENCE_ID` | Fallback audience id |
| `MAILCHIMP_SERVER_PREFIX` | e.g. `us1` |
| `GMAIL_USER` | Fallback sending Gmail address |
| `GMAIL_APP_PASSWORD` | Fallback Gmail app password (16 chars, no spaces) |

---

## Setup (first deploy)

1. Create the Supabase project; copy `SUPABASE_URL` + the service-role key into Vercel env vars
2. Run migrations in order in **Supabase Dashboard → SQL Editor**:
   - `db/migrations/0001_init_multi_tenant.sql`
   - `db/migrations/0002_operator_branding_extras.sql`
   - `db/migrations/0003_trip_audio.sql`
   - `db/migrations/0004_trip_guests.sql`
   - `db/migrations/0005_operator_widget_map_toggle.sql`
   - `db/migrations/0006_bookings.sql`
3. Create two Supabase Storage buckets (Dashboard → Storage → New bucket → toggle **Public bucket** ON):
   - `operator-logos`
   - `trip-audio`
4. Create the auth users (Dashboard → Authentication → Users → Add user, with **Auto Confirm User** checked):
   - the super admin
   - the first operator's captain account
5. Re-run migration 0001 — its bottom block looks up those auth users by email and inserts the `user_profiles` / `operator_users` rows linking them
6. Deploy to Vercel; visit the URL; sign in

---

## Onboarding a new operator

1. **Super admin signs in**, opens the Admin portal
2. Click **+ New Operator**, fill in slug + name (everything else can be filled later)
3. **In Supabase Dashboard → Authentication → Users**, create the new captain's auth user (Auto Confirm)
4. **In SQL Editor**, link the user to the operator:
   ```sql
   INSERT INTO operator_users (user_id, operator_id, role) VALUES (
     (SELECT id FROM auth.users WHERE email = 'newcaptain@example.com'),
     (SELECT id FROM operators WHERE slug = 'big-blue-tours'),
     'owner'
   );
   ```
5. **Wire FareHarbor bookings** (optional, but required for the trip-start pre-fill to do anything):
   - In **Supabase SQL Editor**, set the FH shortname on the operator row so the webhook handler can resolve incoming events:
     ```sql
     UPDATE operators SET fh_company_shortname = 'their-fh-shortname'
       WHERE slug = 'big-blue-tours';
     ```
     The shortname is whatever appears in the FH dashboard URL (e.g. `fareharbor.com/slatermoore/` → `slatermoore`).
   - In the operator's **FareHarbor Dashboard**: Settings → Users & Permissions → [their user] → Webhooks → **+ Add webhook**. Schema: `Bookings only`. Triggers: `New bookings` + `Updated bookings`. URL: `https://trip-logger-backend.vercel.app/api/fh-webhook`.
   - Trigger one test booking and confirm a row appears in `bookings` for that operator.
6. Tell the new captain the URL + their credentials. They sign in, open Settings, fill in their logo / Mailchimp / species list. They're live.

> **Note:** The public sightings widget currently shows sightings from every operator. Per-operator widget filtering is required before a second operator can log live trips without polluting Enocean's widget. Tracked as a known follow-up.

---

## Adding past trips manually

Use the Supabase SQL editor to insert historical sightings in bulk:

```sql
INSERT INTO sightings (operator_id, trip_date, species, count, lat, lng, duration_minutes, distance_nm, passengers, water_temp, visibility) VALUES
((SELECT id FROM operators WHERE slug='enocean'), '2026-05-03', 'Humpback Whale', 1, 36.7813, -121.9846, 446, 17.44, 6, 58, 'Overcast');
```

Leave `depth_meters` out — newly inserted rows sit at `null` until backfilled. The app's `send-report.js` populates depth automatically for every new trip; for manual historical inserts, look up each `(lat, lng)` against NOAA's DEM and `UPDATE sightings SET depth_meters = … WHERE id = …`.

---

## Business Context

This app was built as an MVP for Enocean Tours and is being evaluated as a **white-label SaaS product** for whale-watch operators globally.

The product solves three problems for operators:
1. Guests get a professional keepsake they want to share — organic marketing
2. Every guest email is captured automatically into a remarketing list
3. A direct review CTA is delivered at peak guest satisfaction (right after the trip)

The captain audio recap is the differentiator no other operator currently offers — it turns the public sightings page from a static log into ongoing audio content visitors will actually listen to.

---

Built by Slater Moore — Captain, Marine Wildlife Cinematographer, Moss Landing Harbor.
