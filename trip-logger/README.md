# Enocean Tours — Trip Logger

A mobile-first Progressive Web App (PWA) for logging whale watch trips and delivering branded trip reports to guests.

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
6. Guests are automatically added to the Enocean Tours Mailchimp audience
7. Email includes a direct link to leave a TripAdvisor review

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS — PWA with Service Worker + localStorage |
| Backend | Node.js Serverless Functions on Vercel |
| PDF Generation | PDFKit |
| Story Card | Browser Canvas API |
| Maps | Google Static Maps API |
| Email | Gmail SMTP via Nodemailer |
| CRM | Mailchimp Marketing API |
| Hosting | Vercel (Free tier) |
| Repo | GitHub — enoceantours-whales/trip-logger-backend |

---

## Project Structure

```
trip-logger-backend/
├── trip-logger/
│   ├── Public/
│   │   ├── Enocean_Tours_logo-03.png   # White logo (app header)
│   │   ├── Enocean_Tours_logo-05.png   # Black logo (PDF)
│   │   ├── manifest.json               # PWA manifest
│   │   └── sw.js                       # Service worker
│   ├── api/
│   │   └── send-report.js              # Serverless function — PDF + email
│   ├── index.html                      # Frontend PWA
│   ├── package.json
│   └── vercel.json                     # Internal routing
└── vercel.json                         # Root routing (Vercel reads this)
```

---

## Features

### Trip Logging
- Species dropdown (12 Monterey Bay species)
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

---

## Environment Variables

Set these in Vercel → Settings → Environment Variables:

| Variable | Description |
|---|---|
| `MAILCHIMP_API_KEY` | Mailchimp API key |
| `MAILCHIMP_AUDIENCE_ID` | Mailchimp audience ID |
| `MAILCHIMP_SERVER_PREFIX` | e.g. `us7` |
| `GMAIL_USER` | Sending Gmail address |
| `GMAIL_APP_PASSWORD` | Gmail app password (16 chars, no spaces) |
| `GOOGLE_MAPS_API_KEY` | Google Static Maps API key |

---

## Deployment

1. Push changes to `main` branch on GitHub
2. Vercel auto-deploys on every commit
3. Live at: [trip-logger-backend.vercel.app](https://trip-logger-backend.vercel.app)

---

## Map Configuration

Map is fixed to show the full Monterey Bay including the submarine canyon:
- Center: 36.78, -122.05
- Zoom: 10
- Type: hybrid
- Scale: 2x (high resolution)
- White numbered pins per sighting

---

## Business Context

This app was built as an MVP for Enocean Tours and is being evaluated as a white-label SaaS product for whale watch operators globally.

The product solves three problems for operators:
1. Guests get a professional keepsake they want to share (organic marketing)
2. Every guest email is captured automatically into a remarketing list
3. A direct review CTA is delivered at peak guest satisfaction (right after the trip)

Potential pricing model:
- Small boats (under 20 pax) — $149/month
- Mid size (20-50 pax) — $299/month
- Large (50-150 pax) — $599/month
- Fleet — $999+/month

---

Built by Slater Moore — Captain, Marine Wildlife Cinematographer, Moss Landing Harbor
