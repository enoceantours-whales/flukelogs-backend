# Trip Logger - Post-Launch Roadmap

Planning only. None of this is built. These are the agreed directions to pick up
**after iOS v1 is live on the App Store**. v1 ships first; real crew use informs
what gets built next. Ranked roughly by value and sequencing, with the key
decisions captured so future work starts warm.

Suggested order: A first (the wow feature the owner wants right after launch),
then B and C (cheap, high-charm, mostly web), with D as the foundation that makes
B and C reliable offshore. E and F slot in when they earn their place.

---

## A. Lock-screen Live Activity (active trip)

**What:** While a trip is running, show a live card on the lock screen and
Dynamic Island with duration, distance, and last sighting. Tapping it opens the
app straight to the running trip.

**Why:** The single feature that makes it feel like a premium native app. Owner
wants this first after launch. Quick re-entry from the lock screen is the core
ask.

**Effort:** Medium to high. This is real native iOS work: a WidgetKit extension
in Swift/SwiftUI for the card layout, plus a bridge so the trip lifecycle
(startTrip / each GPS update / endTrip) starts, updates, and ends the activity.

**Key decisions / notes:**
- The engine already exists: the trip runs in the background with live GPS, so
  the activity can update locally as points come in. No new backend needed.
- Tap target deep-links into the active trip screen.
- Needs iOS 16.1+ (fine).

## B. "Currently watching" website status line

**What:** A small live status on the public site, e.g. "Enocean Tours is
currently watching a Humpback Whale" or "out searching for the next sighting."

**Why:** Pure booking bait. Social proof and urgency for site visitors. Lighter
than a live map and, crucially, privacy-clean: it broadcasts activity, not boat
location, so it can never hand competitors your spot.

**Effort:** Low to medium. Almost entirely web work. No native dependency.

**Key decisions / notes:**
- Derived from two facts the app already knows: is a trip active, and the most
  recent sighting (species + time).
- "Watching vs searching" rule: a sighting within the last ~10 to 15 minutes
  reads as "currently watching," otherwise "searching."
- Heartbeat + expiry: the app pings while a trip runs; if pings stop (lost
  signal or trip ended without a clean tap), the status auto-reverts to idle
  after a few minutes so the site never sits on a stale "watching."
- Could grow into "3 species spotted so far today," same cheap data.

## C. Photo gallery on the public widget

**What:** Attach a gallery of the day's photos to a trip, viewable on the public
sightings widget. Added by reopening a past trip (photos get curated after the
day, not mid-trip), in the same area as captain's notes and voice memo.

**Why:** Premium feel, great for reviews and word of mouth. Pairs naturally with
B.

**Effort:** Medium. Mostly web: a multi-photo picker (nice native multi-select
later), a small trip_photos table (like trip_audio), past-trip edit, and the
widget rendering. Compress on upload; tolerate spotty boat signal (pairs with D).

**Key decisions / notes (design landed):**
- Hero photo (the first image) shown large with a count badge; tap opens the full
  gallery. Use the real first photo, not an icon.
- Desktop layout: hero photo beside the species list (two columns, thin divider).
- Mobile layout: columns stack. Photo becomes a full-width banner with a
  **capped height** so the species counts (the actual info) stay on screen.
  Hook the reflow into the widget's existing mobile breakpoint.
- Audio player tweak: hide the "0:00 / 1:22" time readout by default (duration is
  already in the captain's-notes header label); optionally show a compact elapsed
  counter only while playing. Saves width on mobile.
- Fallbacks: no photos means the species list goes full-width as it does today;
  no voice note is fine. If photos exist but no audio, the hero still renders.
- Privacy: photos may show people, so a light consent step. Leans on tightening
  the storage bucket's file-listing permission (already on the security list).

## D. Offline-first

**What:** Run the app from a bundled copy instead of loading the live site, and
queue trips, sightings, and uploads locally, syncing when signal returns.

**Why:** The biggest real-world reliability win. Offshore there is no signal, and
today the app shell needs the network just to open. This is what makes a native
app genuinely better than the PWA for life on the water. It also makes B and C
trustworthy (status and uploads survive dead zones).

**Effort:** High. The original Phase 2 plan already noted "swap in a local
bundle" as the eventual step.

**Key decisions / notes:**
- GPS already records to local storage during a trip; this extends the same idea
  to the whole trip lifecycle and outbound sync.
- The mid-trip upload that B and C need rides on this queue.

## E. Push notifications

**What:** Operator alerts (booking came in, trip report ready) and, more
interestingly, a consumer "alert me when you spot a [species]" feature.

**Why:** The consumer alert is a real growth/marketing channel, not just
workflow. Ties to the long-standing whale-alert idea.

**Effort:** Medium. Needs APNs (rides on the paid Apple account) plus a push
plugin and backend triggers.

## F. Native camera for sightings

**What:** Replace the web file-picker for sighting photos with the native camera.

**Why:** Small change, improves the core logging action, better with wet hands on
a moving boat. Shares the native multi-select with C.

**Effort:** Low.

---

## Dependency map (quick)

- B and C live data depend on **mid-trip upload**, which is cleanest built on **D**.
- E depends on the paid Apple account (APNs).
- C and F share the native photo picker.
