# App Store submission pack (Phase 4)

Copy-paste reference for App Store Connect. Fill the placeholders marked
`<< >>` with values only you can provide. No em dashes anywhere (house rule).

---

## 1. App identity

| Field | Value |
|-------|-------|
| App name | Enocean Tours |
| Subtitle (<=30 chars) | Log trips, routes and sightings |
| Bundle ID | com.enoceantours.triplogger |
| Primary category | Business |
| Secondary category | Travel |
| Age rating | 4+ |
| Price | Free |

> Name note: "Enocean Tours" is 13 chars (limit 30). The subtitle above is 31
> with the word "and"; if App Store Connect rejects it, use "Log trips, routes, sightings" (28).

---

## 2. Promotional text (<=170 chars, editable any time without review)

> Record every trip from the water: live GPS route, distance, and wildlife
> sightings, then send guests a clean trip report. Built for whale watch crews.

---

## 3. Description (<=4000 chars)

Enocean Tours Trip Logger is the on-the-water tool for whale watch and marine
wildlife crews. Start a trip, and the app records your vessel's route by GPS,
tracks distance traveled, and lets you log wildlife sightings as they happen,
all from your phone.

WHAT YOU CAN DO

- Start a trip and automatically record your route, even while the screen is
  locked and the phone is in your pocket.
- Log sightings on the fly: species, counts, times, notes, photos, and audio.
- Capture conditions like water temperature and sea state.
- Pre-fill passenger details from your connected booking system.
- Send guests a polished trip report after the trip, including the route and
  the species seen.
- Show a public sightings feed on your website, with the option to hide precise
  locations from competitors.

BUILT FOR CREWS

The app keeps recording your route in the background during an active trip, so
your distance and breadcrumb path stay accurate for the whole tour. Location is
only collected while a trip is running and stops when you end the trip.

Enocean Tours Trip Logger is a tool for tour operators and their crew. An
operator account is required to use the app.

---

## 4. Keywords (<=100 chars total, comma separated, no spaces)

```
whale watching,trip log,wildlife,sightings,boat,gps,marine,naturalist,ocean,logbook,tour
```
(91 chars. Do not repeat the app name or category words; Apple ignores those.)

---

## 5. URLs

| Field | Value |
|-------|-------|
| Privacy Policy URL | https://trip-logger-backend.vercel.app/privacy.html |
| Support URL | << your support page, e.g. https://enoceantours.com/support or a mailto page >> |
| Marketing URL (optional) | << e.g. https://enoceantours.com >> |

> Apple requires a Support URL. If you do not have a support page, a simple page
> with a contact email works, or I can add a `/support.html` like the privacy page.

---

## 6. What's New (version 1.0)

> First release of Enocean Tours Trip Logger: GPS route recording, wildlife
> sighting logging, and guest trip reports.

---

## 7. App Privacy (the data nutrition label questionnaire)

Answer Apple's "App Privacy" section as follows. We use no third party ad or
analytics SDKs, so nothing is used for tracking.

**Do you or your partners collect data from this app?** Yes.

**Data types collected, and for each: purpose = App Functionality, Linked to
the user = Yes, Used for tracking = No.**

| Apple data type | Collected | Notes |
|-----------------|-----------|-------|
| Contact Info > Email Address | Yes | Account sign-in; booking customer emails |
| Location > Precise Location | Yes | Trip route only, incl. background during a trip |
| User Content > Photos or Videos | Yes | Sighting photos |
| User Content > Audio Data | Yes | Sighting audio notes |
| User Content > Other User Content | Yes | Sighting species, counts, notes |
| Identifiers | No | No advertising or device identifiers used |
| Usage Data | No | No analytics SDK |
| Diagnostics | No | No crash/analytics SDK bundled |

**Tracking (App Tracking Transparency):** No data is used to track users across
apps or websites owned by other companies. You do NOT need an ATT prompt.

**Data used to track you:** None.
**Data linked to you:** Email, Precise Location, Photos, Audio, Other User Content.
**Data not linked to you:** None.

---

## 8. App Review information (reviewer notes)

Sign-in required. Provide a working demo account or the reviewer cannot test.

```
This app is used by marine tour operators and their crew to log trips and
wildlife sightings. An operator account is required.

Demo account:
  Email:    << demo captain email >>
  Password: << demo captain password >>

How to test:
  1. Sign in with the demo account above.
  2. On the Start screen, enter a passenger count and tap Start Trip.
  3. The app begins recording GPS location to draw the route and calculate
     distance. Tap to add a wildlife sighting (species, count, notes).
  4. Tap End Trip to finish.

Background location: the app requests "Always" location so it can keep
recording the vessel's route while the screen is locked during an active
trip. Location is collected ONLY while a trip is running and stops when the
trip ends. It is used solely to record the route and compute distance, never
for advertising, and is not sold.
```

> ACTION: create a dedicated demo captain account (its own operator or a test
> operator) so you are not handing Apple your real login. I can help set one up
> in Supabase when you are ready.

---

## 9. Export compliance

When prompted at upload: the app uses only standard HTTPS/TLS encryption and no
proprietary or non-standard cryptography. Answer the encryption question
accordingly (uses standard encryption, exempt). I will confirm the exact
toggle when we archive.

---

## 10. Still needed from you (checklist)

- [ ] Support URL (or let me add a `/support.html`)
- [ ] Demo captain account (email + password) for the reviewer
- [ ] Screenshots from a real device (I will tell you which screens and sizes)
- [ ] Confirm primary category Business (vs Travel)
- [ ] Confirm the sub-processor list in the privacy policy
