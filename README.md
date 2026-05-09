# Enocean Tours — Trip Logger

A mobile-first Progressive Web App (PWA) for logging whale watch trips, delivering branded trip reports to guests, and displaying a live public sightings log on the Enocean Tours website.

Built and operated by Slater Moore, Captain — [enoceantours.com](https://enoceantours.com)

---

## What It Does

1. Captain starts a trip, enters passenger count and conditions
2. GPS tracks position and calculates nautical miles traveled
3. Captain logs each wildlife sighting (species, count, time, GPS coordinates, notes)
4. At trip end, captain uploads a group photo and enters guest emails
5. App generates and emails each guest:
   - A one-page branded **PDF trip report** (photo, map, sightings log)
   - A **1080x1920 Story card JPG** ready to post on Instagram
6. Trip sightings are automatically saved to Supabase
7. Guests are automatically added to the Enocean Tours Mailchimp audience
8. Email includes a direct link to leave a TripAdvisor review
9. Public sightings widget on enoceantours.com updates automatically after every trip

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS — PWA with Service Worker + localStorage |
| Backend | Node.js Serverless Functions on Vercel |
| Database | Supabase (PostgreSQL) |
| PDF Generation | PDFKit |
| Story Card | Browser Canvas API |
| Trip Report Map | Google Static Maps API |
| Sightings Widget Map | Leaflet + ESRI Ocean Basemap |
| Email | Gmail SMTP via Nodemailer |
| CRM | Mailchimp Marketing API |
| Hosting | Vercel (Free tier) |
| Repo | GitHub — enoceantours-whales/trip-logger-backend |

---

## Project Structure

```
trip-logger-backend/
├── trip-logger/
│   ├── api/
│   │   ├── send-report.js            # Serverless function — PDF + email + Supabase save
│   │   ├── sightings.js              # Serverless function — serves public sightings widget
│   │   └── sightings-widget.html     # Public sightings widget HTML
│   ├── Public/
│   │   ├── Enocean_Tours_logo-03.png # White logo (app header)
│   │   ├── Enocean_Tours_logo-05.png # Black logo (PDF)
│   │   ├── manifest.json             # PWA manifest
│   │   └── sw.js                     # Service worker
│   ├── index.html                    # Frontend PWA
│   ├── env.example
│   └── package.json
└── vercel.json                       # Routing
```

---

## Features

### Trip Logging
- Species dropdown (14 Monterey Bay species including Fin Whale, Minke Whale, Black-footed Albatross)
- Count, time, optional behavior notes per sighting
- GPS coordinates auto-captured per sighting
- Live nautical miles counter (Haversine formula)
- Trip duration timer

### PDF Report (Single Page)
- Black header with logo
- Group photo full bleed
- Stats: date, duration, distance, passengers, sightings
- Conditions bar: visibility, sea state, water temp
- Full-width Monterey Bay satellite map (fixed view showing submarine canyon)
- White numbered pins for each sighting location
- Sightings table: species, count, time, notes + coordinates inline
- Auto-scales font size to fit any number of sightings on one page
- Black footer with website

### Story Card (1080x1920 JPG)
- Guest photo full bleed background
- Dark gradient overlay
- "TODAY WE SAW" with species list in bold
- Auto-scales font size for long species names
- Date and ENOCEANTOURS.COM branding
- Ready to post directly to Instagram Stories

### Email
- Black/white branded HTML email
- Logo, stats, species summary
- "LEAVE US A REVIEW" CTA linking to TripAdvisor
- PDF + Story card attached
- Guest auto-added to Mailchimp with "Trip Guest" tag

### PWA
- Add to iPhone home screen — works like a native app
- Service worker caches app for offline use
- localStorage saves trip state — survives browser refresh mid-trip
- Auto-restores active trip if page reloads

### Public Sightings Widget
- Live at [enoceantours.com/sighting-log](https://enoceantours.com/sighting-log)
- Served via `/api/sightings` — embedded in Squarespace via iframe
- Interactive Leaflet map with ESRI Ocean Basemap showing Monterey Submarine Canyon bathymetry
- Color-coded species markers — click any marker for species + count popup
- Trip log grouped by date — one card per trip, tallied by species
- Click a trip date header to pan map to all sightings that day
- Click a species row to pan map to that specific sighting
- Season totals bar — running whale and dolphin counts
- Auto-resizes iframe height as trips accumulate — no scroll limit
- Pulls live from Supabase sightings table

---

## Database — Supabase

Table: `sightings`

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Auto-generated |
| `trip_date` | date | Date of trip |
| `species` | text | Species name |
| `count` | int4 | Number of individuals |
| `lat` | numeric | GPS latitude |
| `lng` | numeric | GPS longitude |
| `duration_minutes` | int4 | Trip duration |
| `distance_nm` | numeric | Nautical miles traveled |
| `passengers` | int4 | Guest count |
| `water_temp` | numeric | Water temp in °F |
| `visibility` | text | Visibility conditions |
| `conditions` | text | Sea state |
| `behavior_notes` | text | Optional sighting notes |
| `created_at` | timestamptz | Auto-generated |

---

## Environment Variables

Set these in Vercel → Settings → Environment Variables:

| Variable | Description |
|---|---|
| `MAILCHIMP_API_KEY` | Mailchimp API key |
| `MAILCHIMP_AUDIENCE_ID` | Mailchimp audience ID |
| `MAILCHIMP_SERVER_PREFIX` | e.g. `us1` |
| `GMAIL_USER` | Sending Gmail address |
| `GMAIL_APP_PASSWORD` | Gmail app password (16 chars, no spaces) |
| `GOOGLE_MAPS_API_KEY` | Google Static Maps API key |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Supabase service_role key (never expose client-side) |

---

## Deployment

1. Push changes to `main` branch on GitHub
2. Vercel auto-deploys on every commit
3. PWA live at: [trip-logger-backend.vercel.app](https://trip-logger-backend.vercel.app)
4. Sightings widget live at: [trip-logger-backend.vercel.app/api/sightings](https://trip-logger-backend.vercel.app/api/sightings)

---

## Adding Past Trips Manually

Use the Supabase SQL editor to insert historical sightings in bulk:

```sql
INSERT INTO sightings (trip_date, species, count, lat, lng, duration_minutes, distance_nm, passengers, water_temp, visibility) VALUES
('2026-05-03', 'Humpback Whale', 1, 36.7813, -121.9846, 446, 17.44, 6, 58, 'Overcast');
```

---

## Business Context

This app was built as an MVP for Enocean Tours and is being evaluated as a white-label SaaS product for whale watch operators globally.

The product solves three problems for operators:
1. Guests get a professional keepsake they want to share (organic marketing)
2. Every guest email is captured automatically into a remarketing list
3. A direct review CTA is delivered at peak guest satisfaction (right after the trip)

---

Built by Slater Moore — Captain, Marine Wildlife Cinematographer, Moss Landing Harbor
