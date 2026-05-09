const mailchimp = require('@mailchimp/mailchimp_marketing');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const https = require('https');

// Initialize Mailchimp
mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_SERVER_PREFIX || 'us1',
});

// Initialize Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

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

// ─── PDF Generator ───────────────────────────────────────────────────────────

async function generatePDF(tripData) {
  const mapImageBuffer = await fetchMapImage(tripData.sightings);

  let logoBuffer = null;
  try {
    logoBuffer = await fetchURL('https://trip-logger-backend.vercel.app/Public/Enocean_Tours_logo-05.png');
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
        doc.fillColor(MID).font(reg).fontSize(Math.max(fontSize - 1, 6))
           .text(noteText, notesX, textY, { width: cols[3], lineBreak: false });

        y += rowH;
        doc.rect(M, y - 2, CW, 0.5).fill(RULE);
      });
    }

    // ── FOOTER ──
    doc.rect(0, H - 44, W, 44).fill(BLACK);
    doc.fillColor(WHITE).font(bold).fontSize(7)
       .text('ENOCEAN TOURS  •  MOSS LANDING HARBOR, MONTEREY BAY  •  ENOCEANTOURS.COM', M, H - 26, { align: 'center', width: CW, lineBreak: false, characterSpacing: 1 });

    doc.end();
  });
}

// ─── Save to Supabase ─────────────────────────────────────────────────────────

async function saveToSupabase(tripData) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log('Supabase not configured, skipping save');
    return;
  }

  const tripDate = new Date(tripData.startTime).toISOString().split('T')[0];
  const durationMs = new Date(tripData.endTime) - new Date(tripData.startTime);
  const durationMinutes = Math.floor(durationMs / 60000);

  const rows = tripData.sightings.map(s => ({
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

async function addToMailchimp(email) {
  try {
    await mailchimp.lists.addListMember(process.env.MAILCHIMP_AUDIENCE_ID, {
      email_address: email,
      status: 'subscribed',
      tags: ['Trip Guest'],
    });
  } catch (err) {
    console.log('Mailchimp note:', err.message);
  }
}

// ─── Send Email ───────────────────────────────────────────────────────────────

async function sendEmail(guestEmail, pdfBuffer, socialCardData, tripData) {
  const date = new Date(tripData.startTime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const speciesList = tripData.sightings.map(s => `${s.species} (×${s.count})`).join(', ') || 'No sightings logged';
  const duration = getFormattedDuration(tripData.startTime, tripData.endTime);

  const result = await transporter.sendMail({
    from: `"Enocean Tours" <${process.env.GMAIL_USER}>`,
    to: guestEmail,
    subject: `Your Enocean Tours Trip Report — ${date}`,
    html: `<body style="margin:0;padding:0;background:#111111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="600" style="margin:0 auto;background:#1a1a1a;overflow:hidden;">
  <tr><td style="background:#000000;padding:32px;text-align:center;border-bottom:1px solid #222;">
    <img src="https://trip-logger-backend.vercel.app/Public/Enocean_Tours_logo-03.png" alt="Enocean Tours" width="180" style="display:block;margin:0 auto 12px;">
    <p style="color:rgba(255,255,255,0.5);margin:0;font-size:10px;letter-spacing:3px;text-transform:uppercase;">TRIP REPORT</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="color:#ffffff;font-size:15px;margin:0 0 12px;">Hi there,</p>
    <p style="color:#888888;font-size:14px;line-height:1.6;margin:0 0 24px;">Thank you for joining us on the water. Your trip report and story card are attached.</p>
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
      <a href="https://www.enoceantours.com/reviews" style="background:#ffffff;color:#000000;padding:14px 36px;text-decoration:none;font-weight:bold;font-size:14px;display:inline-block;letter-spacing:0.5px;">LEAVE US A REVIEW</a>
      <p style="margin:10px 0 0;color:#555;font-size:12px;">It takes 2 minutes and means the world to us.</p>
    </div>
    <p style="color:#444;font-size:12px;text-align:center;margin:0;border-top:1px solid #222;padding-top:20px;">Moss Landing Harbor, Monterey Bay, CA<br><a href="https://enoceantours.com" style="color:#888;">enoceantours.com</a></p>
  </td></tr>
</table>
</body>`,
    attachments: [
      {
        filename: `Enocean_Trip_${new Date(tripData.startTime).toISOString().split('T')[0]}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
      ...(socialCardData ? [{
        filename: `Enocean_Story_${new Date(tripData.startTime).toISOString().split('T')[0]}.jpg`,
        content: Buffer.from(socialCardData.replace(/^data:image\/\w+;base64,/, ''), 'base64'),
        contentType: 'image/jpeg',
      }] : []),
    ],
  });

  console.log('Gmail sent:', result.messageId);
  return result;
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tripData, guestEmails, socialCardData } = req.body;
  if (!tripData || !guestEmails) return res.status(400).json({ error: 'Missing tripData or guestEmails' });

  // Accept either a single email string or an array
  const emails = Array.isArray(guestEmails) ? guestEmails : [guestEmails];

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const validEmails = emails.map(e => e.trim()).filter(e => emailRegex.test(e));
  if (validEmails.length === 0) return res.status(400).json({ error: 'No valid email addresses provided' });

  try {
    console.log('Generating PDF...');
    const pdfBuffer = await generatePDF(tripData);
    console.log('PDF done, size:', pdfBuffer.length);

    // Save to Supabase ONCE regardless of how many guests
    await saveToSupabase(tripData);

    // Send email + Mailchimp to each guest
    await Promise.all(validEmails.map(email => Promise.all([
      sendEmail(email, pdfBuffer, socialCardData, tripData),
      addToMailchimp(email),
    ])));

    return res.status(200).json({ success: true, message: `Trip report sent to ${validEmails.join(', ')}` });
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: 'Failed to send trip report', detail: err.message });
  }
};
