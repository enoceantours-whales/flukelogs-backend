# Trip Logger → Multi-Operator: Audit & Plan (Phase 1)

> **Status:** Phase 1 — audit and plan only. No application code or production data
> was changed to produce this document. All findings were verified against the live
> Supabase project (`czotpzjtnuukoxscjduj`) read-only and against the code in this repo
> as of 2026-06-18.

---

## 0. TL;DR — the most important thing to know

**You are not starting a single-operator → multi-operator conversion. You're roughly 80–85% of the way through one already.** A previous push (the `db/migrations/0001_init_multi_tenant.sql` lineage and everything after it) already built the tenant model, added `operator_id` to every data table, moved Enocean's config out of env vars and into an `operators` row, stood up role-based auth, RLS, an admin portal, and an operator-scoped public widget. Enocean is live as "Operator #1" on that multi-tenant schema right now.

So this plan is mostly about **finishing and hardening** what exists — not designing from scratch. The remaining work clusters into four buckets:

1. **One real isolation gap to close** (the only thing that would actually *leak* data between operators): the public widget reads the `sightings` and `trip_audio` tables directly with the **anon key**, which is governed by an RLS policy of `USING (true)` — i.e. "anyone can read every row." Today that's harmless because there's exactly one operator. The moment a second operator exists, the shared anon key can read *all* operators' sightings (including GPS coordinates) regardless of the `?op=` slug. **This is the headline finding.** (§4, §6.A)

2. **Per-operator branding that's still hardcoded to Enocean** in places the dynamic-config system doesn't yet reach: the PWA manifest, service-worker cache name, email templates, and a handful of code fallbacks. These don't *leak* data — they'd make Operator #2's app/emails say "Enocean Tours." (§5)

3. **A missing self-serve onboarding/signup flow.** Adding an operator today is a manual super-admin + SQL-Editor procedure. Fine for a few hand-held operators; a blocker for scale. (§6.D)

4. **Process/security hygiene:** an unauthenticated FareHarbor webhook, a publicly-listable shared storage bucket, and repo↔database migration drift that needs a real migration workflow before we touch production again. (§6.E, §7, §8)

If you read nothing else, read **§4 (how isolation actually works here)** and **§9 (open questions only you can answer)**.

---

## 1. Verified stack (corrections to the starting assumptions)

| You said | Reality (verified) |
|---|---|
| Hosting: Vercel | ✅ Confirmed. `trip-logger/vercel.json` defines rewrites; `api/*.js` are Vercel serverless functions (Node 20). |
| Backend/data: Supabase | ✅ Confirmed. Postgres 17, project `czotpzjtnuukoxscjduj`, region us-east-2. RLS, Storage, Auth all in use. **No edge functions** and **no scheduled jobs (cron)** in the Supabase project. |
| Frontend: a PWA | ✅ Confirmed, but worth stating precisely: it's **vanilla HTML + JS, no framework, no build step.** `index.html` is the captain PWA; `profile.html` is the guest SPA; the widget is server-rendered HTML. There is no React/Next/Vite. |
| GitHub org `enoceantours-whales` | ✅ Confirmed. Relevant repos: `trip-logger-backend` (this one) and `enocean-whale-alert` (a *separate, unrelated* Python scraper — see §1.1). |
| Public sightings widget via iframe | ✅ Confirmed, and already operator-aware via `?op=<slug>` (defaults to `enocean`). |
| "single-operator tool" | ⚠️ **Out of date.** The codebase is already multi-tenant by design; Enocean is just the first tenant. |

### 1.1 The two repos

- **`trip-logger-backend`** — this app. The multi-tenant trip logger. Everything below is about this.
- **`enocean-whale-alert`** — a standalone Python 3.11 script (GitHub Actions, BeautifulSoup, Mailchimp, Claude API). It scrapes a *third-party* public sightings page (`montereybaywhalewatch.com`) and sends Mailchimp alert emails. **It does not touch the Supabase DB, does not read trip-logger data, and is hardcoded to Enocean.** It is out of scope for multi-tenancy unless you later decide to fold its "alert subscribers when X is seen" behavior into the product. Flagging it only so it's not mistaken for shared infrastructure.

---

## 2. Inventory

### 2.1 Project structure

```
trip-logger-backend/
├── db/migrations/            # 17 SQL files, hand-applied via Supabase SQL Editor (see §8 drift warning)
├── supabase/email-templates/ # confirm-signup.html, magic-link.html  (Enocean-branded)
└── trip-logger/
    ├── index.html            # Captain PWA (all screens, ~1800+ lines, inline JS)
    ├── profile.html          # Guest profile SPA (magic-link login + "My Trips")
    ├── email-preview.html    # Dev preview of the guest email
    ├── manifest.json (Public/)# PWA manifest — HARDCODED Enocean
    ├── Public/sw.js          # Service worker — cache name 'enocean-v2'
    ├── Public/Enocean_Tours_logo-0{3,5}.png
    ├── vercel.json           # rewrites
    ├── package.json          # deps: @mailchimp/mailchimp_marketing, nodemailer, pdfkit
    ├── env.example
    ├── lib/
    │   ├── auth.js           # operator/captain JWT auth + operator resolution
    │   ├── guest-auth.js     # guest JWT auth
    │   └── operators.js      # load operator row, pick() fallback, publicOperatorView() secret-stripping
    └── api/
        ├── sightings.js          # PUBLIC — renders the widget HTML, resolves ?op=slug → operator
        ├── sightings-widget.html # the widget client (fetches data with anon key) — see §4
        ├── send-report.js        # AUTH — generates PDF + sends guest email + Mailchimp + records guests
        ├── fh-webhook.js         # PUBLIC — FareHarbor booking webhook (UNAUTHENTICATED, see §7)
        ├── trip-audio.js         # AUTH — upload/delete captain audio note
        ├── me.js                 # AUTH — returns operator config (secrets stripped)
        ├── operator-settings.js  # AUTH — read/update own operator row
        ├── operator-logo-upload.js # AUTH — upload logo to storage
        ├── static-map.js         # PUBLIC — Google Static Maps proxy
        ├── buoy-conditions.js    # PUBLIC — NOAA buoy proxy (default station 46092)
        ├── demo-request.js        # PUBLIC — marketing lead capture
        ├── landing.js             # PUBLIC — marketing landing page (Enocean demo embedded)
        ├── admin/
        │   ├── operators.js       # SUPER-ADMIN — list/create operators
        │   ├── operators/[id].js  # SUPER-ADMIN — get/update/delete an operator
        │   ├── operators/invite.js# SUPER-ADMIN — invite a captain
        │   └── sightings.js       # SUPER-ADMIN — all-operator sightings view
        ├── operator/
        │   ├── sightings.js       # AUTH — own sightings
        │   ├── trips.js           # AUTH — own trips list
        │   └── bookings.js        # AUTH — own bookings by date
        └── guest/
            ├── me.js              # GUEST-AUTH — own profile
            ├── trips.js           # GUEST-AUTH — own attended trips
            └── profile.js         # GUEST-AUTH — create/update own profile
```

### 2.2 Database tables (live, public schema)

| Table | Purpose | `operator_id`? | RLS enabled | Effective public (anon) access |
|---|---|---|---|---|
| `operators` | One row per company; all per-operator config + credentials | (is the tenant) | ✅ | none (auth-scoped select/update; super-admin insert/delete) |
| `user_profiles` | `is_super_admin` flag on auth users (operator staff) | — | ✅ | own row only |
| `operator_users` | Links auth user → operator, with `role` (owner/captain/viewer) | ✅ | ✅ | own rows only |
| `sightings` | The core log: species, count, lat/lng, depth, time | ✅ NOT NULL | ✅ | **`USING (true)` — anon reads ALL rows ⚠️** |
| `trip_audio` | Captain audio note per trip | ✅ NOT NULL | ✅ | **`USING (true)` — anon reads ALL rows ⚠️** |
| `trip_guests` | Who was emailed on which trip (+ `guest_id` link) | ✅ NOT NULL | ✅ | deny-all to anon; guest reads own |
| `bookings` | FareHarbor bookings | ✅ NOT NULL | ✅ | deny-all (service-role only) |
| `guest_profiles` | Customer-facing profiles (magic-link) | — | ✅ | own row only |
| `demo_requests` | Marketing leads | — | ✅ | deny-all (service-role only) |

**Live data scale:** 1 operator, 1 operator_user, 1 super-admin, 140 sightings, 36 bookings, 27 trip_guests, 14 trip_audio, 3 guest_profiles, 0 demo_requests. Trips span 2026-05-03 → 2026-06-18. This is small enough to migrate safely and large enough that **every row matters** — these are real guest emails and real trips.

### 2.3 External integrations

| Integration | Where configured | Per-operator? |
|---|---|---|
| **Mailchimp** (guest list) | `operators.mailchimp_api_key / _audience_id / _server_prefix` | ✅ Yes (moved off env vars) |
| **Gmail SMTP** (nodemailer, guest report email) | `operators.gmail_user / gmail_app_password` | ✅ Yes (moved off env vars) |
| **FareHarbor** (bookings webhook) | `operators.fh_company_shortname` matches incoming `company.shortname` | ✅ Yes — but webhook is unauthenticated (§7) |
| **Google Static Maps** | `GOOGLE_MAPS_API_KEY` env var (shared infra key) | Key shared (fine); map *center* is per-operator config but some code paths still hardcode Monterey Bay (§5) |
| **NOAA buoy** | `operators.noaa_buoy_station` (default 46092) | ✅ config exists; `buoy-conditions.js` default still Monterey Bay (§5) |
| **Supabase Storage** | single public `media` bucket, paths namespaced `…/<slug>/…` | ⚠️ paths isolated but bucket is publicly **listable** (§7) |

### 2.4 PWA / auth specifics

- **Manifest:** name `"Enocean Tours Trip Logger"`, short_name `"Enocean"`, icon `Enocean_Tours_logo-03.png`, `start_url:/`, standalone, black theme. All hardcoded.
- **Service worker (`sw.js`):** cache name `enocean-v2`. HTML = network-first; `/api/*` = never cached; other assets = cache-first. `skipWaiting()` + old-cache cleanup on activate.
- **Captain auth:** Supabase email+password (with a first-run "set password" screen from an invite/recovery link). Supabase client uses the **anon key, hardcoded inline** in `index.html` (`SUPABASE_URL` + `SUPABASE_ANON`). After login the app calls `/api/me` to load operator config and brands itself dynamically (name, species list, buoy station, etc.).
- **Guest auth:** magic-link (OTP) via `profile.html`, also using the inline anon key.
- **The anon key is public by design** (it's in the browser). Its blast radius is entirely determined by RLS — which is exactly why §4 matters.

---

## 3. How the multi-tenancy model works today (the concepts)

Two ideas do all the work here. Worth internalizing them because every decision below follows from them.

### 3.1 Multi-tenancy = a discriminator column + disciplined scoping

This app uses the **shared-database, shared-schema** model: every tenant's rows live in the same tables, told apart by a `operator_id` column (the "tenant discriminator"). That's the simplest and cheapest multi-tenancy model, and the right one at this scale. The alternative models (a schema per tenant, or a database per tenant) buy you stronger isolation at a large operational cost — not worth it until you have compliance requirements or noisy-neighbor problems you don't have.

The entire promise of isolation therefore rests on one rule: **every query that touches a tenant table must be scoped by `operator_id`.** If a single query forgets the filter, that's a leak. So you want that rule enforced in as few, as central, places as possible — ideally by the database itself, not by remembering to add `WHERE operator_id = …` in 20 endpoints.

### 3.2 Two enforcement layers — and the service-role bypass

There are two independent places isolation can be enforced here:

- **Application layer.** The server functions authenticate a request (`lib/auth.js` → verify the Supabase JWT → look up the user's `operator_id`), then manually add `operator_id=eq.<that id>` to every query. The audit found this is done **correctly and consistently** across all `/api/operator/*`, `/api/admin/*`, and `/api/guest/*` endpoints. Good.

- **Database layer (RLS).** Row Level Security lets Postgres attach an invisible `WHERE` clause to every query based on *who is asking*. A policy like `USING (operator_id IN (select operator_id from operator_users where user_id = auth.uid()))` means a logged-in captain literally *cannot* read another operator's rows even if their query forgets the filter — the database removes those rows before returning them.

**The crucial subtlety:** the server functions connect with the Supabase **`service_role` key, which bypasses RLS entirely.** That's deliberate and normal — the server is trusted and needs to act across the auth boundary. But it means **RLS does *not* protect the server endpoints; the application-layer scoping does.** RLS only protects the things that connect with the **anon key** — i.e. the browser: the captain PWA's direct reads, the guest SPA, and the public widget.

So the mental model is:
- **Server endpoints (service role):** isolation = application-layer `operator_id` filters. ✅ Solid today.
- **Browser/anon clients:** isolation = RLS policies. ✅ Solid for everything *except* `sightings` and `trip_audio`, which are wide open (§4).

This is a perfectly good architecture. The gap is narrow and specific.

---

## 4. The one real isolation gap (read this twice)

The public widget (`api/sightings-widget.html`) does **not** fetch sightings through a server endpoint. It fetches them **directly from PostgREST in the browser using the anon key**:

```js
// sightings-widget.html (data fetch)
const url = `${SUPABASE_URL}/rest/v1/sightings?operator_id=eq.${OPERATOR_ID}`
          + `&select=trip_id,trip_part,trip_date,sighting_time,species,count,lat,lng,depth_meters,created_at`
          + `&order=trip_date.desc,created_at.desc&limit=${FEED_LIMIT}`;
fetch(url, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } });
```

The `operator_id=eq.${OPERATOR_ID}` filter is supplied by the **client**. The actual security boundary is the RLS policy on `sightings`, which is:

```
policy "Public read"  on sightings  for SELECT  to public  USING (true)
policy "trip_audio_public_read" on trip_audio for SELECT to public USING (true)
```

`USING (true)` means **"return every row to anyone holding the anon key."** The anon key is printed in plain text in `index.html`, `profile.html`, and the widget HTML — it is effectively public. So **anyone** can today run:

```
GET /rest/v1/sightings?select=*            # no operator filter at all
GET /rest/v1/sightings?operator_id=eq.<any-other-operators-id>&select=lat,lng,species
```

…and get back **every operator's full sighting log, including exact GPS coordinates.** The client-side `operator_id=eq` filter is cosmetic — a polite request the database is free to ignore, and does.

**Why it's not a fire today:** there is exactly one operator, and that operator's sightings are *intentionally public* (they're shown on a public website widget). So there is currently nothing to leak. **Why it becomes a fire at operator #2:** the data is no longer "all public anyway." Specifically:

- The `operators.show_map_on_widget = false` opt-out (migration 0005 — "some operators do not want to share the GPS locations of sightings") is enforced **only in the widget's JavaScript.** An operator who toggles their map off still has every `lat`/`lng` readable via a direct REST call. The privacy control is a curtain, not a wall.
- One operator can silently enumerate a competitor's sighting hotspots — commercially sensitive in this industry.

**This is the single most important thing to fix before a second operator's data lands in this database.** The fix is in §6.C.

> Bookings, trip_guests, demo_requests, operators, user_profiles are all correctly locked (deny-all to anon, or own-row-only). The gap is specifically `sightings` and `trip_audio`.

---

## 5. Single-tenant assumptions still hardcoded to Enocean

None of these *leak* data; they'd make Operator #2's experience say "Enocean." Grouped by how they'd surface.

**A. Branding the dynamic-config system already covers (low effort, just wire the fallback):**

| File | What's hardcoded |
|---|---|
| `api/send-report.js` `brand()` | Fallbacks `'Enocean Tours'`, slug `'enocean'`, `'https://enoceantours.com'`, tagline `'MOSS LANDING HARBOR, MONTEREY BAY'`, review URL, both Enocean logo PNGs |
| `api/send-report.js` | `const CENTER = '36.78,-122.05'` — PDF map always centers on Monterey Bay (operator has `default_map_center`; just isn't read here) |
| `api/buoy-conditions.js` | default station `46092` (operator has `noaa_buoy_station`; endpoint is public so has no operator context — see §6.E) |
| `api/landing.js` | embeds `?op=enocean`, contact `enoceantours@gmail.com`, "Slater Moore runs Enocean Tours…" bio |

> Note: the `pick(operator, field, fallback)` helper means that **as long as an operator's row is fully filled in, these Enocean fallbacks never fire.** The risk is a half-onboarded operator with NULL fields getting Enocean branding on their guest emails. Onboarding validation (§6.D) is the real fix; the fallbacks are a safety net that should arguably become generic ("Your Tour Co") rather than Enocean-specific.

**B. Per-operator app shell the dynamic system does *not* yet cover (needs a real solution, §6.F):**

| File | What's hardcoded | Why it's harder |
|---|---|---|
| `Public/manifest.json` | app name, short_name, icons | A PWA has one manifest per origin. Per-operator install identity needs per-operator manifests (templated by `?op=` or subdomain). |
| `Public/sw.js` | cache name `enocean-v2` | Cosmetic; rename to a neutral `trip-logger-v#`. |
| `index.html` / `profile.html` | `<title>`, apple app name, logo `<img>`, "Moss Landing · Monterey Bay" kicker, **inline Supabase URL + anon key** | Title/logo/kicker should come from `/api/me` config (some already do post-login; the initial paint is Enocean). The anon key being inline is fine (it's public) but is Enocean-project-specific. |
| `supabase/email-templates/*.html` | Enocean logo (GitHub raw URL), "Enocean Tours · Moss Landing Harbor", enoceantours.com | These are **Supabase Auth's** transactional emails (magic link, confirm signup), configured in the Supabase dashboard, not per-operator-aware. Multi-operator magic-link branding is a known limitation of shared Supabase Auth (§9 Q5). |
| `sightings-widget.html` | `<title> … Enocean Tours`, default map center, CTA links to `enoceantours.com/tours` | Title/CTA should come from the operator row injected as `__OP_CONFIG`; map center already has the field. |

---

## 6. The plan

The work is sequenced so **Enocean never breaks** and each step is small and independently revertable. Nothing here is implemented yet — this is the proposal for the gated phases that follow.

### 6.A Tenant model — **already built, keep as-is**

- `operators` (tenant), `operator_users` (membership + role: owner/captain/viewer), `user_profiles.is_super_admin` (platform staff). Composite PK on `operator_users` already allows one user in multiple operators later.
- **Recommendation:** no schema change to the tenant model. One small hardening item: `lib/auth.js` resolves operator via `…operator_users?user_id=eq.X&limit=1` — fine while each user belongs to one operator, but `limit=1` silently picks an arbitrary operator if a user ever belongs to two. Make "active operator" explicit before you enable multi-operator membership.

### 6.B Schema changes — **mostly done; minimal remaining**

`operator_id` is already on every data table, NOT NULL, indexed, with Enocean backfilled. The remaining schema work is small and supports the RLS change in §6.C, not the tenant model itself. No destructive changes to existing columns. Enocean's data is already cleanly "Operator #1."

### 6.C RLS design — **the core of this project**

**DECIDED (2026-06-18): public sightings are strictly per-operator.** The owner's rationale: some operators will want to hide their sighting data so competitors can't see where they're finding whales. So per-operator isolation is the security boundary; aggregation, if ever wanted, is a separate opt-in feature built on top — never the default. (A bay-wide "what's being seen today" view remains a possible future product feature, but only with explicit operator consent, never as a side effect of how RLS is written.)

Given per-operator isolation, two ways to implement it. I recommend **Option 2.**

- **Option 1 — keep anon direct reads, scope the policy.** You can't parameterize an anon RLS policy by "which operator is this widget for" (the anon role has no identity). So the only honest anon policy is either `USING (true)` (status quo, leaky) or one keyed off a request setting — which PostgREST doesn't give you cleanly for anon. This option can't actually enforce the `show_map_on_widget` opt-out. **Reject.**

- **Option 2 — route public widget reads through a server endpoint (recommended).**
  1. Add a small public server function, e.g. `GET /api/widget-data?op=<slug>`, that uses the **service role**, resolves the slug → operator, returns *only that operator's* sightings + audio, and **omits `lat`/`lng` when `show_map_on_widget = false`** (the opt-out becomes real and server-enforced).
  2. Change `sightings-widget.html` to fetch from that endpoint instead of hitting PostgREST directly with the anon key.
  3. **Then** flip the RLS policies: replace `sightings`'s `"Public read" USING (true)` and `trip_audio`'s `trip_audio_public_read USING (true)` with no anon SELECT at all (service-role-only, like `bookings`). The guest-scoped policy `sightings_select_own_trips_guest` stays.
  - **Result:** the anon key stops being a data-exfiltration vector entirely; cross-operator enumeration becomes impossible; the map opt-out is enforced by the database/server, not by client JS.
  - **Enocean safety:** Enocean's widget keeps working — it just sources data from the new endpoint. The RLS flip is the *last* step, after the new endpoint is verified live, so there's no window where the widget is broken. Fully revertable (re-add the `USING (true)` policy) if anything misbehaves.

This is the highest-value change in the whole project and is independent of onboarding/branding, so it can ship first (see §6.G and §10).

### 6.D Auth & onboarding

- **Today:** super-admin creates the operator in the admin portal, then *manually* creates the captain's auth user in the Supabase dashboard and links them via SQL. Workable for a handful of hand-held operators.
- **For scale, build (later phase):**
  1. A self-serve **"create your operator"** signup: captain signs up (Supabase Auth) → creates an `operators` row (slug + name) → becomes its `owner` in `operator_users`. Wrap in a transaction/RPC so a half-created tenant can't exist.
  2. **Crew invites by the owner** (not just super-admin): owner invites a captain/viewer by email; invitee accepts and gets an `operator_users` row scoped to that operator with the chosen role. The super-admin `invite.js` flow is a good template to generalize.
  3. **Onboarding completeness gate:** block "send guest report" / "publish widget" until the required operator fields are set (from_email + gmail_app_password, name, logo, species_list, map center, buoy station, timezone, home port). This is what actually prevents the Enocean-fallback-branding problem in §5.A.
  4. **Roles:** `owner` can edit settings + manage crew + log trips; `captain` can log trips + send reports but not edit billing/credentials; `viewer` read-only. The role column and checks exist in part; tighten enforcement per-endpoint.

### 6.E Per-operator config for the public proxies

`buoy-conditions.js` and `static-map.js` are public (no JWT) so they can't read an operator row from auth. Two clean options: (a) accept `?op=<slug>` and look up `noaa_buoy_station` / `default_map_center` server-side, or (b) have the captain app pass the operator's already-loaded config values as query params. Either removes the Monterey-Bay default for other regions. Low priority (cosmetic for non-Monterey operators), but cheap.

### 6.F Frontend / PWA impact

- **Stays the same:** the whole authenticated captain workflow, the guest flow, the data model. Post-login dynamic branding already works via `/api/me`.
- **Changes needed for true white-label:**
  - Neutralize the static shell: rename the SW cache to a non-Enocean name; make `<title>`, the initial logo, and the kicker render from config (accept a brief Enocean-branded first paint, or gate first paint on config).
  - Decide the **tenant addressing scheme** (§9 Q3): query param (`?op=slug`), path (`/o/slug/…`), or subdomain (`slug.app…`). This determines how per-operator manifests and the widget embed URL are generated. Subdomain gives the cleanest per-operator PWA install identity but is the most infra work (wildcard DNS + Vercel domains). **Recommendation: start with `?op=`/path (already how the widget works), move to subdomains only if/when operators want their own branded install.**
  - Per-operator PWA manifest: serve a templated manifest that fills name/short_name/icons/theme from the operator row.
- **Supabase Auth transactional emails** (magic link / confirm signup) are global to the project and can't easily be per-operator branded — keep them operator-neutral ("Trip Logger") rather than Enocean-branded (§9 Q5).

### 6.G Migration sequencing (never breaks the live boat)

Ordered so each step is independently shippable and revertable, and Enocean keeps logging throughout:

1. **Establish a real migration workflow first (do before touching prod again).** Resolve the repo↔DB drift (§8): adopt the Supabase CLI, capture current live schema as a baseline migration, and from here on test every migration on a **Supabase dev branch** before prod. Get your explicit go-ahead before any `apply_migration`.
2. **Close the isolation gap (§6.C Option 2):** add `/api/widget-data` → point the widget at it → verify on Enocean → flip the two `USING (true)` policies to service-role-only. (Highest value, lowest blast radius — touches only the public widget path.)
3. **Neutralize static branding (§5.B / §6.F):** SW cache rename, generic fallbacks, config-driven title/logo. Pure cosmetics, no data risk.
4. **Harden onboarding (§6.D):** completeness gate + owner-initiated crew invites + self-serve operator creation.
5. **Security hygiene (§7):** authenticate the FareHarbor webhook; tighten the `media` bucket so it isn't world-listable; clear the remaining advisors.
6. **Per-operator proxies (§6.E)** and **tenant addressing / per-operator manifest (§6.F)** as the platform genuinely needs them.
7. **Onboard a real Operator #2** on a dev branch first, exercise the full flow end-to-end, *then* in prod.

Every DB step: write the migration → test on a Supabase dev branch → confirm with you → apply to prod → verify. No drops or column changes against existing Enocean data.

---

## 7. Security findings beyond the isolation gap

| # | Finding | Severity | Note |
|---|---|---|---|
| S1 | **`sightings` / `trip_audio` anon `USING (true)`** | **High (post-2nd-operator)** | The §4 gap. Fix in §6.C. |
| S2 | **FareHarbor webhook `api/fh-webhook.js` is unauthenticated.** It maps incoming `company.shortname` → operator and upserts a booking, with no signature/secret check. | **High** | Anyone who knows an operator's FH shortname can inject/alter bookings for that operator. Add HMAC/shared-secret verification before processing. Verify how FareHarbor signs its webhooks for this account. |
| S3 | **Public `media` storage bucket is listable** (advisor `0025`): one broad SELECT policy lets any client *list all files* in the shared bucket. Paths are namespaced per operator slug, but listing exposes every operator's filenames. | Medium | Restrict the bucket's list/SELECT policy; rely on object URLs for read. Cross-operator file *enumeration*, not full read of private data (logos/audio are semi-public). |
| S4 | `increment_audio_play` is a `SECURITY DEFINER` function executable by anon/authenticated (advisors `0028`/`0029`). | Low (intentional) | This is by design (migration 0015 — the widget bumps a play counter). It can only `+1` one column. Document as accepted, or tighten if you dislike it. |
| S5 | `guest_stats` has a mutable `search_path` (advisor `0011`). | Low | One-line `ALTER FUNCTION … SET search_path = public` (migration 0007 did this for it once; a later redefinition in 0013 dropped the setting — re-add it). |
| S6 | Supabase Auth **leaked-password protection disabled.** | Low | Toggle on in dashboard (HaveIBeenPwned check). |

---

## 8. Repo ↔ database drift (process risk — fix before next prod change)

The repo's `db/migrations/` folder and Supabase's own migration history **do not match**, because the early multi-tenant migrations were applied by pasting SQL into the dashboard rather than through a migration tool:

- `db/migrations/0001`–`0004` (the multi-tenant core, trip_audio, trip_guests) are **not** in Supabase's `schema_migrations` history at all — the tracked history starts at `0005`.
- Supabase's history contains a `create_media_storage_bucket` migration (2026-06-17) that has **no corresponding file** in `db/migrations/`.
- The base `sightings` table definition exists in neither place (it predates the migrations folder; columns were read live for this audit).

**Implication:** the repo is not a reliable source of truth for the schema, and "re-run the migrations folder" would not reproduce production. Before any further production schema change, adopt a single migration workflow (Supabase CLI), snapshot the live schema as a baseline, and route all future changes through dev-branch-tested migrations. This is step 1 of §6.G for a reason.

---

## 9. Open questions — decisions only you can make

1. ~~**Public sightings: per-operator or aggregated?**~~ **DECIDED — strictly per-operator** (operators can hide their data from competitors). RLS design in §6.C proceeds on this basis.
2. **Is white-label the actual goal, or "a few operators I onboard by hand"?** This sets the priority of self-serve onboarding (§6.D) and per-operator branding (§6.F). If it's hand-held for now, S1/S2 security fixes matter far more than manifests and subdomains.
3. **Tenant addressing scheme:** `?op=slug` (status quo) / path `/o/slug` / subdomain `slug.app…`? Affects PWA install identity, widget embeds, and DNS work. I lean: start with the existing slug param, add subdomains only when an operator wants their own branded install.
4. **Billing — in scope now or later?** Nothing billing-related exists today. I'd defer it until the isolation gap and onboarding are done, but if you intend to charge from day one, the `operators` table should grow a plan/status concept and onboarding should gate on it.
5. **Magic-link / auth email branding:** Supabase Auth's transactional emails are project-global. Are you OK with neutral "Trip Logger" branding on those (my recommendation), or is per-operator auth-email branding a requirement (which would push toward a heavier setup)?
6. **Naming:** the product/platform name (the thing that isn't "Enocean Tours"). Drives the neutral app name, SW cache name, manifest, and auth-email copy.
7. **Logo / asset hosting for operators:** keep per-operator uploads in the shared `media` bucket with tightened listing (simplest), or give each operator a clearer namespace? Ties to S3.
8. **The `enocean-whale-alert` scraper:** leave it standalone, or eventually turn "alert my subscribers when species X is seen" into a real multi-operator product feature fed by the trip-logger DB? Out of scope for now; flagging for the roadmap.

---

## 10. Recommended first implementation step

**Close the isolation gap (§6.C, Option 2) — but do step 0 first.**

- **Step 0 (process, no code):** stand up the Supabase CLI migration workflow and a dev branch, and baseline the current live schema (resolves §8). This is the safety harness for everything after it.
- **Step 1 (the fix):** build `GET /api/widget-data?op=<slug>` (service-role, operator-scoped, honors `show_map_on_widget`), repoint `sightings-widget.html` to it, verify Enocean's live widget against it, **then** flip the `sightings` and `trip_audio` `USING (true)` policies to service-role-only.

Why this first: it's the only finding that causes an actual cross-operator data leak, it's contained to the public widget path (Enocean's captain workflow is untouched), it's fully revertable, and it makes the `show_map_on_widget` privacy promise real. Branding and onboarding can follow without any data at risk.

**No code or production changes have been made. Awaiting your go-ahead and your answers to §9 before starting any implementation.**
