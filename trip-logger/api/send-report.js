const mailchimp = require('@mailchimp/mailchimp_marketing');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const https = require('https');

const { authenticate } = require('../lib/auth');
const { getOperator, pick } = require('../lib/operators');

// Per-request transporter — Gmail credentials live on the operator row now,
// so we can't build a module-level singleton. createTransport returns a fresh
// pool that's used once and discarded; nodemailer handles the actual reuse
// internally for the duration of a single sendMail call.
//
// Credentials come strictly from the operator row. gmail_user falls back to
// from_email since for plain Gmail accounts those are always the same; the
// captain only sees one field in Settings ("From" Email Address) plus their
// 16-char App Password. The gmail_user column stays in the schema for
// Workspace-alias setups where they legitimately differ — super-admin sets
// that via the Admin UI when needed.
function buildTransporter(operator) {
  const user = (operator && (operator.gmail_user || operator.from_email)) || null;
  const pass = (operator && operator.gmail_app_password) || null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

// Mailchimp's SDK is a singleton — calling setConfig mutates global state.
// In Vercel serverless this is fine because each function invocation runs in
// its own (or warm-reused) instance; we re-set per request to make sure the
// right operator's audience is targeted.
//
// Credentials come strictly from the operator row. There used to be env-var
// fallbacks (MAILCHIMP_API_KEY etc.) for single-tenant back-compat, but those
// would silently route a misconfigured operator's signups through whoever
// owned the env var — a footgun once we onboard a second operator.
function configureMailchimp(operator) {
  mailchimp.setConfig({
    apiKey: operator && operator.mailchimp_api_key,
    server: (operator && operator.mailchimp_server_prefix) || 'us1',
  });
}

// ─── Per-guest whale log (migration 0004) ──────────────────────────────
// Records who's been emailed on which trip so the next email can open with
// "Welcome back — your 3rd trip with us. You've now spotted 8 species..."
// instead of the generic greeting.

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + 'th';
  switch (n % 10) {
    case 1: return n + 'st';
    case 2: return n + 'nd';
    case 3: return n + 'rd';
    default: return n + 'th';
  }
}

// Insert one row per guest into trip_guests for today's trip. Uses
// resolution=merge-duplicates so re-sending the same trip is idempotent.
async function recordGuestsForTrip(operatorId, tripDate, emails) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !operatorId || !tripDate || !emails || emails.length === 0) return;
  const rows = emails.map(e => ({
    operator_id: operatorId,
    trip_date:   tripDate,
    email:       String(e).toLowerCase().trim(),
  }));
  try {
    const res = await fetch(`${url}/rest/v1/trip_guests?on_conflict=operator_id,email,trip_date`, {
      method: 'POST',
      headers: {
        'apikey':        key,
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (!res.ok) console.error('recordGuestsForTrip:', res.status, (await res.text()).slice(0, 200));
  } catch (err) {
    console.error('recordGuestsForTrip error:', err.message);
  }
}

// Asks Postgres for how many trips and species this email has logged with
// the operator. Falls back to {trips: 1, species: 0} on any failure so the
// email still sends with the first-timer copy.
async function getGuestStats(operatorId, email) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const fallback = { trips: 1, species: 0 };
  if (!url || !key || !operatorId || !email) return fallback;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/guest_stats`, {
      method: 'POST',
      headers: {
        'apikey':        key,
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ op_id: operatorId, email_in: String(email).toLowerCase().trim() }),
    });
    if (!res.ok) return fallback;
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return fallback;
    return {
      trips:   Number.isFinite(+row.trips)   ? +row.trips   : 1,
      species: Number.isFinite(+row.species) ? +row.species : 0,
    };
  } catch (err) {
    console.error('getGuestStats error:', err.message);
    return fallback;
  }
}

// Resolves every per-operator branding string used by the PDF, email, and
// captain copy. Centralized so adding a new branded surface = one edit here
// instead of hunting for hardcoded "Enocean" strings.
function brand(operator) {
  const websiteUrl = pick(operator, 'website_url', 'https://enoceantours.com');
  const websiteHost = (websiteUrl || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').toUpperCase();
  // Logo fallbacks point at /Public/ assets served by the running app, not a
  // hardcoded vercel.app domain — so previews and any future custom domain
  // still work. Only fires when an operator has no logo_url set yet.
  const appUrl = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  return {
    name:        pick(operator, 'name',           'Enocean Tours'),
    slug:        pick(operator, 'slug',           'enocean'),
    tagline:     pick(operator, 'tagline',        'MOSS LANDING HARBOR, MONTEREY BAY'),
    logoPdf:     pick(operator, 'logo_url',       `${appUrl}/Public/Enocean_Tours_logo-05.png`),
    logoEmail:   pick(operator, 'logo_url_email', `${appUrl}/Public/Enocean_Tours_logo-03.png`),
    reviewUrl:   pick(operator, 'review_url',     'https://www.enoceantours.com/reviews'),
    websiteUrl,
    websiteHost,
    fromEmail:   operator && operator.from_email,
    audienceId:  operator && operator.mailchimp_audience_id,
  };
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Auth helpers live in ../lib/auth.js so /api/me and future endpoints share
// the same JWT verification and operator-resolution logic.

function getFormattedDuration(startTime, endTime) {
  const diffMs = new Date(endTime) - new Date(startTime);
  const diffMins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMins / 60);
  const minutes = diffMins % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// ─── Fetch Google Maps Static Image ──────────────────────────────────────────

function fetchMapImage(sightings) {
  return new Promise((resolve) => {
    const withCoords = sightings.filter(s => s.lat && s.lng);

    const CENTER = '36.78,-122.05';
    const ZOOM   = '10';

    if (withCoords.length === 0) {
      const url = `https://maps.googleapis.com/maps/api/staticmap?center=${CENTER}&zoom=${ZOOM}&size=640x400&scale=2&maptype=hybrid&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      fetchURL(url).then(resolve).catch(() => resolve(null));
      return;
    }

    const markers = withCoords.map((s, i) =>
      `markers=color:white|label:${i + 1}|${s.lat},${s.lng}`
    ).join('&');

    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${CENTER}&zoom=${ZOOM}&size=640x400&scale=2&maptype=hybrid&${markers}&key=${process.env.GOOGLE_MAPS_API_KEY}`;

    fetchURL(url).then(resolve).catch(() => resolve(null));
  });
}

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── Bathymetry (NOAA NCEI global DEM mosaic) ───────────────────────────────
// Returns positive depth in meters at the given lat/lng, or null if the point
// is above sea level, the request times out (3s), or the API errors out.
//
// NOAA's DEM_global_mosaic returns elevation in meters: negative = below sea
// level, positive = above. We invert the sign so callers always see depth as
// a positive number, and discard land readings (positive elevation -> null).
function fetchDepth(lat, lng) {
  return new Promise((resolve) => {
    const geometry = encodeURIComponent(JSON.stringify({
      x: lng, y: lat, spatialReference: { wkid: 4326 },
    }));
    const url = `https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_global_mosaic/ImageServer/identify`
      + `?geometry=${geometry}&geometryType=esriGeometryPoint&returnGeometry=false&f=json`;

    let settled = false;
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };

    const req = https.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const raw = body && body.value;
          const elevation = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
          if (!Number.isFinite(elevation) || elevation >= 0) return done(null);
          done(Math.abs(elevation));
        } catch (e) {
          done(null);
        }
      });
      res.on('error', () => done(null));
    });
    req.on('error', () => done(null));
    req.setTimeout(3000, () => { req.destroy(); done(null); });
  });
}

// Mutates the sightings array, attaching depth_meters to every sighting that
// has valid lat/lng. All lookups run in parallel (each capped at 3s by
// fetchDepth's internal timeout), so total wall time is ~3s worst case
// regardless of how many sightings the trip has.
async function attachDepthsToSightings(sightings) {
  if (!Array.isArray(sightings) || sightings.length === 0) return;
  const depths = await Promise.all(sightings.map(s =>
    (s && s.lat != null && s.lng != null) ? fetchDepth(s.lat, s.lng) : Promise.resolve(null)
  ));
  sightings.forEach((s, i) => { s.depth_meters = depths[i]; });
}

// Format depth for display: "847m" under 1km, "1.2km" otherwise. Returns
// null when input is null/undefined/non-numeric so callers can use as a guard.
function formatDepthLabel(m) {
  if (m == null || !Number.isFinite(Number(m))) return null;
  const v = Number(m);
  return v < 1000 ? `${Math.round(v)}m` : `${(v / 1000).toFixed(1)}km`;
}

// ─── PDF Generator ───────────────────────────────────────────────────────────

async function generatePDF(tripData, b) {
  const mapImageBuffer = await fetchMapImage(tripData.sightings);

  let logoBuffer = null;
  try {
    logoBuffer = await fetchURL(b.logoPdf);
  } catch(e) {
    console.log('Logo fetch failed:', e.message);
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 0,
      size: 'LETTER',
      autoFirstPage: false,
      bufferPages: true,
    });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const BLACK = '#000000';
    const WHITE = '#ffffff';
    const GRAY  = '#f0f0f0';
    const MID   = '#777777';
    const RULE  = '#cccccc';

    const W  = 612;
    const H  = 792;
    const M  = 40;
    const CW = W - M * 2;
    const bold = 'Helvetica-Bold';
    const reg  = 'Helvetica';

    const date     = new Date(tripData.startTime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const duration = getFormattedDuration(tripData.startTime, tripData.endTime);

    doc.addPage({ size: 'LETTER', margin: 0 });

    // ── HEADER ──
    const headerH = 72;
    doc.rect(0, 0, W, headerH).fill(BLACK);

    const logoRadius = 24;
    const logoCX = M + logoRadius;
    const logoCY = headerH / 2;
    doc.circle(logoCX, logoCY, logoRadius).fill(WHITE);
    if (logoBuffer) {
      try {
        const logoSize = logoRadius * 2 - 4;
        doc.image(logoBuffer, logoCX - logoSize/2, logoCY - logoSize/2, { width: logoSize, height: logoSize });
      } catch(e) {
        doc.fillColor(BLACK).font(bold).fontSize(6).text('ENOCEAN', logoCX - 18, logoCY - 6, { lineBreak: false });
        doc.fillColor(BLACK).font(bold).fontSize(5).text('TOURS', logoCX - 12, logoCY + 2, { lineBreak: false });
      }
    } else {
      doc.fillColor(BLACK).font(bold).fontSize(6).text('ENOCEAN', logoCX - 18, logoCY - 6, { lineBreak: false });
      doc.fillColor(BLACK).font(bold).fontSize(5).text('TOURS', logoCX - 12, logoCY + 2, { lineBreak: false });
    }

    doc.fillColor(WHITE).font(bold).fontSize(18)
       .text('TRIP REPORT', 0, headerH/2 - 10, { align: 'center', width: W, lineBreak: false, characterSpacing: 3 });

    doc.fillColor(WHITE).font(reg).fontSize(8)
       .text(date.toUpperCase(), M, headerH/2 + 10, { align: 'right', width: CW, lineBreak: false, characterSpacing: 0.5 });

    let y = headerH;

    // ── PHOTO (left) + STATS (right) ──
    const photoW = Math.round(W * 0.58);
    const photoH = 200;

    if (tripData.photoData) {
      try {
        const b64 = tripData.photoData.replace(/^data:image\/\w+;base64,/, '');
        const buf = Buffer.from(b64, 'base64');
        doc.save();
        doc.rect(0, y, photoW, photoH).clip();
        doc.image(buf, 0, y, { cover: [photoW, photoH], align: 'center', valign: 'center' });
        doc.restore();
      } catch(e) {
        doc.rect(0, y, photoW, photoH).fill('#111');
      }
    } else {
      doc.rect(0, y, photoW, photoH).fill('#111');
      doc.fillColor(MID).font(reg).fontSize(9)
         .text('No photo', 0, y + photoH/2 - 6, { align: 'center', width: photoW, lineBreak: false });
    }

    const statsX = photoW + 1;
    const statsW = W - photoW - 1;
    doc.rect(statsX, y, statsW, photoH).fill(GRAY);

    const distanceNM = tripData.distanceNM ? tripData.distanceNM.toFixed(2) + ' NM' : 'N/A';
    const statItems = [
      { label: 'DURATION',   value: duration },
      { label: 'DISTANCE',   value: distanceNM },
      { label: 'PASSENGERS', value: String(tripData.passengers) },
      { label: 'SIGHTINGS',  value: String(tripData.sightings.length) },
    ];

    const statBlockH = photoH / statItems.length;
    statItems.forEach((stat, i) => {
      const sy = y + i * statBlockH;
      if (i > 0) doc.rect(statsX + 12, sy, statsW - 24, 0.5).fill(RULE);
      doc.fillColor(MID).font(reg).fontSize(7)
         .text(stat.label, statsX + 16, sy + 10, { width: statsW - 24, lineBreak: false, characterSpacing: 1 });
      doc.fillColor(BLACK).font(bold).fontSize(20)
         .text(stat.value, statsX + 16, sy + 22, { width: statsW - 24, lineBreak: false });
    });

    y += photoH;

    // ── CONDITIONS STRIP ──
    doc.rect(0, y, W, 26).fill(BLACK);
    const condParts = [];
    if (tripData.visibility) condParts.push('Visibility: ' + tripData.visibility);
    if (tripData.conditions)  condParts.push('Sea: ' + tripData.conditions);
    if (tripData.waterTemp)   condParts.push('Water: ' + tripData.waterTemp + '°F');
    doc.fillColor(WHITE).font(reg).fontSize(8)
       .text(condParts.join('   •   ') || 'Monterey Bay', 0, y + 8, { align: 'center', width: W, lineBreak: false, characterSpacing: 0.8 });
    y += 26;

    // ── MAP ──
    const mapH = 180;
    if (mapImageBuffer) {
      try {
        doc.image(mapImageBuffer, 0, y, { width: W, height: mapH });
      } catch(e) {
        doc.rect(0, y, W, mapH).fill('#ddd');
        console.error('Map error:', e.message);
      }
    } else {
      doc.rect(0, y, W, mapH).fill('#e5e5e5');
      doc.fillColor(MID).font(reg).fontSize(9)
         .text('Map unavailable', 0, y + mapH/2, { align: 'center', width: W, lineBreak: false });
    }
    y += mapH;

    // ── SIGHTINGS LOG ──
    y += 12;
    doc.fillColor(BLACK).font(bold).fontSize(9)
       .text('SIGHTINGS LOG', M, y, { lineBreak: false, characterSpacing: 1.5 });
    y += 13;
    doc.rect(M, y, CW, 1).fill(BLACK);
    y += 8;

    const cols = [200, 60, 60, CW - 320];
    const headers = ['SPECIES', 'COUNT', 'TIME', 'NOTES & LOCATION'];
    let cx = M;
    headers.forEach((h, i) => {
      doc.fillColor(MID).font(bold).fontSize(7)
         .text(h, cx, y, { width: cols[i], lineBreak: false, characterSpacing: 0.8 });
      cx += cols[i];
    });
    y += 14;
    doc.rect(M, y, CW, 0.5).fill(RULE);
    y += 6;

    const footerY = H - 44;
    const availableH = footerY - y - 10;
    const totalRows = tripData.sightings.length || 1;
    const maxRowH = 28;
    const minRowH = 18;
    const rowH = Math.min(maxRowH, Math.max(minRowH, Math.floor(availableH / totalRows)));
    const fontSize = rowH <= 20 ? 7 : rowH <= 24 ? 8 : 9;

    if (tripData.sightings.length === 0) {
      doc.fillColor(MID).font(reg).fontSize(9).text('No sightings logged', M, y, { lineBreak: false });
    } else {
      tripData.sightings.forEach((s, i) => {
        const bg = i % 2 === 0 ? WHITE : GRAY;
        doc.rect(M - 4, y - 2, CW + 8, rowH).fill(bg);
        doc.rect(M - 4, y - 2, 3, rowH).fill(BLACK);

        const textY = y + (rowH - fontSize) / 2 - 2;

        doc.fillColor(BLACK).font(bold).fontSize(fontSize)
           .text(s.species.toUpperCase(), M, textY, { width: cols[0] - 8, lineBreak: false });
        doc.fillColor(BLACK).font(reg).fontSize(fontSize)
           .text('×' + s.count, M + cols[0], textY, { width: cols[1], lineBreak: false });
        doc.fillColor(BLACK).font(reg).fontSize(fontSize)
           .text(s.time, M + cols[0] + cols[1], textY, { width: cols[2], lineBreak: false });

        const notesX = M + cols[0] + cols[1] + cols[2];
        let noteText = s.notes || '';
        if (s.lat && s.lng) {
          const coords = s.lat.toFixed(4) + ', ' + s.lng.toFixed(4);
          noteText = noteText ? noteText + '  •  ' + coords : coords;
        }
        const depthLabel = formatDepthLabel(s.depth_meters);
        if (depthLabel) {
          noteText = noteText ? noteText + '  ·  ' + depthLabel + ' depth' : depthLabel + ' depth';
        }
        doc.fillColor(MID).font(reg).fontSize(Math.max(fontSize - 1, 6))
           .text(noteText, notesX, textY, { width: cols[3], lineBreak: false });

        y += rowH;
        doc.rect(M, y - 2, CW, 0.5).fill(RULE);
      });
    }

    // ── FOOTER ──
    doc.rect(0, H - 44, W, 44).fill(BLACK);
    const footerText = [b.name.toUpperCase(), b.tagline, b.websiteHost].filter(Boolean).join('  •  ');
    doc.fillColor(WHITE).font(bold).fontSize(7)
       .text(footerText, M, H - 26, { align: 'center', width: CW, lineBreak: false, characterSpacing: 1 });

    doc.end();
  });
}

// ─── Save to Supabase ─────────────────────────────────────────────────────────

async function saveToSupabase(tripData, operatorId) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log('Supabase not configured, skipping save');
    return;
  }
  if (!operatorId) {
    console.error('saveToSupabase called without operatorId — refusing to insert untagged rows');
    return;
  }

  const tripDate = new Date(tripData.startTime).toISOString().split('T')[0];
  const durationMs = new Date(tripData.endTime) - new Date(tripData.startTime);
  const durationMinutes = Math.floor(durationMs / 60000);

  const rows = tripData.sightings.map(s => ({
    operator_id: operatorId,
    trip_date: tripDate,
    duration_minutes: durationMinutes,
    distance_nm: parseFloat((tripData.distanceNM || 0).toFixed(2)),
    passengers: tripData.passengers,
    water_temp: tripData.waterTemp ? parseFloat(tripData.waterTemp) : null,
    visibility: tripData.visibility || null,
    conditions: tripData.conditions || null,
    species: s.species,
    count: s.count,
    behavior_notes: s.notes || null,
    lat: s.lat ? parseFloat(s.lat.toFixed(6)) : null,
    lng: s.lng ? parseFloat(s.lng.toFixed(6)) : null,
    depth_meters: (s.depth_meters != null && Number.isFinite(Number(s.depth_meters)))
      ? parseFloat(Number(s.depth_meters).toFixed(2))
      : null,
  }));

  if (rows.length === 0) {
    console.log('No sightings to save');
    return;
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/sightings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(rows),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Supabase save error:', err);
    } else {
      console.log(`Saved ${rows.length} sightings to Supabase`);
    }
  } catch(e) {
    console.error('Supabase fetch error:', e.message);
  }
}

// ─── Mailchimp ────────────────────────────────────────────────────────────────

async function addToMailchimp(email, b) {
  if (!b.audienceId) { console.log('No Mailchimp audience configured for this operator, skipping'); return; }
  try {
    await mailchimp.lists.addListMember(b.audienceId, {
      email_address: email,
      status: 'subscribed',
      tags: ['Trip Guest'],
    });
  } catch (err) {
    console.log('Mailchimp note:', err.message);
  }
}

// ─── Send Email ───────────────────────────────────────────────────────────────

async function sendEmail(guestEmail, pdfBuffer, socialCardData, tripData, b, transporter, operatorId) {
  const date = new Date(tripData.startTime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const speciesList = tripData.sightings.map(s => `${s.species} (×${s.count})`).join(', ') || 'No sightings logged';
  const duration = getFormattedDuration(tripData.startTime, tripData.endTime);

  // Pull this guest's prior-trip stats (post-insert of today's row, so trips
  // includes today). Pick first-timer vs returning copy. If the lookup fails,
  // getGuestStats returns the first-timer fallback so the email still sends.
  const stats = await getGuestStats(operatorId, guestEmail);
  const greetingHTML = stats.trips <= 1
    ? `<p style="color:#ffffff;font-size:15px;margin:0 0 12px;">Hi there,</p>
       <p style="color:#888888;font-size:14px;line-height:1.6;margin:0 0 24px;">Welcome aboard your first ${b.name} trip — your wildlife log starts here. Your trip report and story card are attached.</p>`
    : `<p style="color:#ffffff;font-size:15px;margin:0 0 12px;">Welcome back,</p>
       <p style="color:#888888;font-size:14px;line-height:1.6;margin:0 0 24px;">This is your <strong style="color:#fff;">${ordinal(stats.trips)} trip</strong> with us.${stats.species >= 2 ? ` You've now spotted <strong style="color:#fff;">${stats.species} species</strong> across all your trips.` : ''} Your trip report and story card are attached.</p>`;

  const result = await transporter.sendMail({
    from: `"${b.name}" <${b.fromEmail}>`,
    to: guestEmail,
    subject: `Your ${b.name} Trip Report — ${date}`,
    html: `<body style="margin:0;padding:0;background:#111111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="600" style="margin:0 auto;background:#1a1a1a;overflow:hidden;">
  <tr><td style="background:#000000;padding:32px;text-align:center;border-bottom:1px solid #222;">
    <img src="${b.logoEmail}" alt="${b.name}" width="180" style="display:block;margin:0 auto 12px;">
    <p style="color:rgba(255,255,255,0.5);margin:0;font-size:10px;letter-spacing:3px;text-transform:uppercase;">TRIP REPORT</p>
  </td></tr>
  <tr><td style="padding:32px;">
    ${greetingHTML}
    <table width="100%" style="margin-bottom:24px;">
      <tr>
        <td width="48%" style="background:#000;padding:14px;border-left:4px solid #ffffff;"><p style="margin:0;color:#888;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">Date</p><p style="margin:4px 0 0;color:#fff;font-weight:bold;">${date}</p></td>
        <td width="4%"></td>
        <td width="48%" style="background:#000;padding:14px;border-left:4px solid #ffffff;"><p style="margin:0;color:#888;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">Duration</p><p style="margin:4px 0 0;color:#fff;font-weight:bold;">${duration}</p></td>
      </tr>
      <tr><td colspan="3" style="height:10px;"></td></tr>
      <tr>
        <td width="48%" style="background:#000;padding:14px;border-left:4px solid #ffffff;"><p style="margin:0;color:#888;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">Passengers</p><p style="margin:4px 0 0;color:#fff;font-weight:bold;">${tripData.passengers}</p></td>
        <td width="4%"></td>
        <td width="48%" style="background:#000;padding:14px;border-left:4px solid #ffffff;"><p style="margin:0;color:#888;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">Sightings</p><p style="margin:4px 0 0;color:#fff;font-weight:bold;">${tripData.sightings.length}</p></td>
      </tr>
    </table>
    <div style="background:#000;padding:14px;margin-bottom:28px;border-left:4px solid #ffffff;">
      <p style="margin:0 0 6px;color:#888;font-weight:bold;font-size:10px;text-transform:uppercase;letter-spacing:1px;">What We Saw</p>
      <p style="margin:0;color:#ffffff;font-size:14px;">${speciesList}</p>
    </div>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${b.reviewUrl}" style="background:#ffffff;color:#000000;padding:14px 36px;text-decoration:none;font-weight:bold;font-size:14px;display:inline-block;letter-spacing:0.5px;">LEAVE US A REVIEW</a>
      <p style="margin:10px 0 0;color:#555;font-size:12px;">It takes 2 minutes and means the world to us.</p>
    </div>
    <p style="color:#444;font-size:12px;text-align:center;margin:0;border-top:1px solid #222;padding-top:20px;">${b.tagline}<br><a href="${b.websiteUrl}" style="color:#888;">${b.websiteHost.toLowerCase()}</a></p>
  </td></tr>
</table>
</body>`,
    attachments: [
      {
        filename: `${b.slug}-trip-${new Date(tripData.startTime).toISOString().split('T')[0]}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
      ...(socialCardData ? [{
        filename: `${b.slug}-story-${new Date(tripData.startTime).toISOString().split('T')[0]}.jpg`,
        content: Buffer.from(socialCardData.replace(/^data:image\/\w+;base64,/, ''), 'base64'),
        contentType: 'image/jpeg',
      }] : []),
    ],
  });

  console.log('Gmail sent:', result.messageId);
  return result;
}

// ─── Captain copy (IG-ready image) ────────────────────────────────────────────
// Sends a separate email back to the operator's from_email with the PDF-styled
// 1080x1920 captain card attached. The captain downloads it from their inbox
// and decides whether to post to Instagram. Best-effort: any failure here is
// logged but doesn't fail the trip end response.
async function sendCaptainCopy(captainCardData, tripData, b, transporter) {
  if (!captainCardData) return;
  if (!b.fromEmail) {
    console.log('No from_email configured for this operator, skipping captain copy');
    return;
  }
  try {
    const date = new Date(tripData.startTime).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const dateSlug = new Date(tripData.startTime).toISOString().split('T')[0];
    const speciesList = tripData.sightings.map(s => `${s.species} (×${s.count})`).join(', ') || 'No sightings';

    await transporter.sendMail({
      from: `"${b.name}" <${b.fromEmail}>`,
      to: b.fromEmail,
      subject: `Captain copy — ${date} — ready for Instagram`,
      text: `Captain copy for the ${date} trip.\n\nSpecies: ${speciesList}\nSightings: ${tripData.sightings.length}\n\nDownload the attached image and post it to Instagram if you want — guests did NOT receive this.`,
      attachments: [{
        filename: `${b.slug}-captain-${dateSlug}.jpg`,
        content: Buffer.from(captainCardData.replace(/^data:image\/\w+;base64,/, ''), 'base64'),
        contentType: 'image/jpeg',
      }],
    });
    console.log('Captain copy emailed to', b.fromEmail);
  } catch (err) {
    console.error('Captain copy email failed:', err.message);
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Step 3 lockdown: every send must come from a logged-in operator user.
  // authenticate() returns null after writing the appropriate 401/403; we
  // bail out immediately so no PDF is rendered, no email is sent, no
  // sighting is saved on a request without a valid session.
  const auth = await authenticate(req, res);
  if (!auth) return;
  const { operatorId } = auth;

  // Step 4: pull the full operator row so every branding string, credential,
  // and email destination comes from the database instead of process.env.
  const operator = await getOperator(operatorId);
  const b = brand(operator);
  const transporter = buildTransporter(operator);
  configureMailchimp(operator);

  const { tripData, guestEmails, socialCardData, captainCardData } = req.body;
  if (!tripData || !guestEmails) return res.status(400).json({ error: 'Missing tripData or guestEmails' });

  // Accept either a single email string or an array
  const emails = Array.isArray(guestEmails) ? guestEmails : [guestEmails];

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const validEmails = emails.map(e => e.trim()).filter(e => emailRegex.test(e));
  if (validEmails.length === 0) return res.status(400).json({ error: 'No valid email addresses provided' });

  try {
    // Fetch bathymetric depth for each sighting first so the PDF and
    // Supabase row both pick it up. Lookups run in parallel and are
    // capped at 3s each, so this adds at most ~3s to the trip end flow.
    await attachDepthsToSightings(tripData.sightings);

    console.log('Generating PDF...');
    const pdfBuffer = await generatePDF(tripData, b);
    console.log('PDF done, size:', pdfBuffer.length);

    // Save to Supabase ONCE regardless of how many guests. Every row is
    // tagged with the operator_id derived from the verified JWT, so a
    // request from one operator can never write into another's data.
    await saveToSupabase(tripData, operatorId);

    // Record this trip's guests BEFORE the emails fire so getGuestStats()
    // (called inside sendEmail) sees today's row in its count. A first-timer
    // gets trips=1, a 2nd-trip guest gets trips=2.
    const tripDateISO = new Date(tripData.startTime).toISOString().split('T')[0];
    await recordGuestsForTrip(operatorId, tripDateISO, validEmails);

    // Send email + Mailchimp to each guest, plus the captain copy back to
    // ourselves — all in parallel. Captain copy failure never blocks the
    // guest emails (it swallows its own errors inside sendCaptainCopy).
    await Promise.all([
      ...validEmails.map(email => Promise.all([
        sendEmail(email, pdfBuffer, socialCardData, tripData, b, transporter, operatorId),
        addToMailchimp(email, b),
      ])),
      sendCaptainCopy(captainCardData, tripData, b, transporter),
    ]);

    return res.status(200).json({ success: true, message: `Trip report sent to ${validEmails.join(', ')}` });
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: 'Failed to send trip report', detail: err.message });
  }
};
