// GET /api/landing — public-facing marketing page for the trip-logger app.
//
// B2B landing aimed at whale-watch operators. Single-page pitch with a
// live embed of Enocean's sightings widget as the product proof. Routed
// at /landing via vercel.json so the captain app at / is unaffected.
//
// Held intentionally lean: every section is meant to be one screen on
// mobile, copy is tight, no marketing-template chrome. Built to be the
// URL Slater pastes into a cold email and feel "of the same product"
// as the captain app and the public widget.

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min — content rarely changes
  const origin = `https://${req.headers.host}`;
  // Live widget on the page so visitors see real Enocean data, not a mockup.
  const widgetSrc = `${origin}/api/sightings?op=enocean`;
  const contactEmail = 'enoceantours@gmail.com';
  const mailtoHref = `mailto:${contactEmail}?subject=Whale-watch%20operator%20platform%20%E2%80%94%20demo%20request`;

  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Trip Logger — Software for whale-watch operators</title>
<meta name="description" content="A captain-led operations platform that turns every whale-watch trip into a branded report, a personalized email to each guest, and a live sightings log on your marketing site.">
<meta property="og:title" content="Trip Logger — software for whale-watch operators">
<meta property="og:description" content="Every trip becomes your marketing. Built by a working captain.">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;1,9..144,400&family=JetBrains+Mono:wght@400;500&family=Open+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --ink:    #0a0c0e;
    --ink-2:  #0f1316;
    --ink-3:  #161b1f;
    --ink-4:  #1d2429;
    --hair:   rgba(255,255,255,0.08);
    --hair-2: rgba(255,255,255,0.14);
    --text:       #f4f6f7;
    --text-dim:   rgba(244,246,247,0.62);
    --text-faint: rgba(244,246,247,0.42);
    --teal:   #6fb1ac;
    --gold:   #c8a86b;
  }
  html, body {
    background:
      radial-gradient(120% 60% at 50% 110%, rgba(64,108,118,.35) 0%, rgba(20,32,38,.35) 35%, transparent 70%),
      radial-gradient(80% 50% at 50% -10%, rgba(80,118,128,.12) 0%, transparent 60%),
      linear-gradient(180deg, #06090b 0%, #0a0e11 40%, #0d1418 70%, #0a1014 100%);
    background-attachment: fixed;
    color: var(--text);
    font-family: "Open Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    font-size: 15.5px;
    line-height: 1.55;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 980px; margin: 0 auto; padding: 0 22px; }

  /* ── Nav ─────────────────────────────────────────────── */
  .nav {
    padding: 24px 0 12px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .brand {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 19px; font-weight: 500; letter-spacing: -0.01em;
    color: var(--text);
  }
  .brand-mark {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: var(--teal); box-shadow: 0 0 12px var(--teal);
    margin-right: 8px; vertical-align: 1px;
  }
  .nav-cta {
    font: 600 11px/1 "Open Sans", sans-serif;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--text-dim); text-decoration: none;
    padding: 9px 14px; border: 1px solid var(--hair); border-radius: 999px;
    transition: color .15s, border-color .15s, background .15s;
  }
  .nav-cta:hover { color: var(--text); border-color: var(--hair-2); background: rgba(255,255,255,.03); }

  /* ── Hero ────────────────────────────────────────────── */
  .hero { padding: 64px 0 48px; }
  .kicker {
    font: 600 11px/1 "Open Sans", sans-serif;
    letter-spacing: 0.26em; text-transform: uppercase;
    color: var(--teal); margin-bottom: 22px;
  }
  .hero h1 {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 300;
    font-size: clamp(40px, 6vw, 68px);
    line-height: 1.02; letter-spacing: -0.018em;
    color: var(--text);
    max-width: 14ch;
  }
  .hero h1 em {
    font-style: italic; color: var(--teal);
  }
  .hero p.lede {
    margin-top: 22px; max-width: 56ch;
    font-size: 17px; color: var(--text-dim);
    line-height: 1.55;
  }
  .hero-ctas {
    margin-top: 30px; display: flex; gap: 12px; flex-wrap: wrap;
    align-items: center;
  }
  .btn-primary {
    background: linear-gradient(180deg, #fff 0%, #e8edee 100%);
    color: #0a0c0e;
    border: 0; border-radius: 999px;
    padding: 14px 26px;
    font: 700 11px/1 "Open Sans", sans-serif;
    letter-spacing: 0.26em; text-transform: uppercase;
    text-decoration: none;
    box-shadow: 0 1px 0 rgba(255,255,255,.6) inset, 0 16px 32px rgba(0,0,0,.45);
    transition: transform .15s ease;
    cursor: pointer; display: inline-flex; align-items: center;
  }
  .btn-primary:hover { transform: translateY(-1px); }
  .btn-secondary {
    color: var(--text-dim);
    font: 500 12px/1 "Open Sans", sans-serif;
    letter-spacing: 0.08em;
    text-decoration: none;
    padding: 12px 8px;
    transition: color .15s;
  }
  .btn-secondary:hover { color: var(--text); }
  .btn-secondary::after { content: " →"; opacity: .65; }

  /* ── Section ───────────────────────────────────────────── */
  section { padding: 56px 0; border-top: 1px solid var(--hair); }
  .section-label {
    font: 600 10px/1 "Open Sans", sans-serif;
    letter-spacing: 0.28em; text-transform: uppercase;
    color: var(--text-faint); margin-bottom: 12px;
  }
  .section-h2 {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 300;
    font-size: clamp(28px, 3.6vw, 38px);
    letter-spacing: -0.01em; line-height: 1.1;
    color: var(--text);
    max-width: 22ch;
  }
  .section-lede {
    margin-top: 14px; max-width: 64ch;
    color: var(--text-dim); font-size: 15.5px;
  }

  /* ── Three deliverables ───────────────────────────────── */
  .threecol {
    margin-top: 30px;
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px;
  }
  @media (max-width: 760px) { .threecol { grid-template-columns: 1fr; } }
  .card {
    border: 1px solid var(--hair); border-radius: 14px;
    background: rgba(255,255,255,0.015);
    padding: 22px 22px 24px;
    transition: border-color .15s, background .15s;
  }
  .card:hover { border-color: var(--hair-2); background: rgba(255,255,255,0.03); }
  .card-num {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11px; color: var(--gold);
    margin-bottom: 10px;
    letter-spacing: 0.06em;
  }
  .card-h {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 400;
    font-size: 22px; line-height: 1.2;
    color: var(--text); margin-bottom: 8px;
  }
  .card-p {
    color: var(--text-dim); font-size: 14px; line-height: 1.55;
  }

  /* ── Features ─────────────────────────────────────────── */
  .features {
    margin-top: 32px;
    display: grid; grid-template-columns: 1fr 1fr; gap: 28px 36px;
  }
  @media (max-width: 760px) { .features { grid-template-columns: 1fr; gap: 26px; } }
  .feature-h {
    font: 600 14px/1.3 "Open Sans", sans-serif;
    color: var(--text); margin-bottom: 6px;
    display: flex; align-items: center; gap: 10px;
  }
  .feature-dot {
    display: inline-block; width: 6px; height: 6px; border-radius: 50%;
    background: var(--teal); box-shadow: 0 0 8px var(--teal);
  }
  .feature-p {
    color: var(--text-dim); font-size: 14px; line-height: 1.55;
  }

  /* ── Live widget showcase ─────────────────────────────── */
  .demo-frame {
    margin-top: 28px;
    border: 1px solid var(--hair);
    border-radius: 14px;
    overflow: hidden;
    background: var(--ink-3);
    box-shadow: 0 18px 48px rgba(0,0,0,0.45);
  }
  .demo-chrome {
    padding: 10px 14px;
    background: var(--ink-2);
    border-bottom: 1px solid var(--hair);
    display: flex; align-items: center; gap: 10px;
    font: 500 11px/1 "JetBrains Mono", monospace;
    color: var(--text-faint);
  }
  .demo-chrome-dots { display: flex; gap: 5px; }
  .demo-chrome-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--hair-2); }
  .demo-url {
    margin-left: 6px; padding: 4px 10px;
    background: var(--ink-3); border-radius: 4px;
    color: var(--text-dim); font-size: 11px;
  }
  .demo-frame iframe {
    width: 100%; height: 1280px;
    border: 0; display: block; background: var(--ink);
  }

  /* ── Captain bio ──────────────────────────────────────── */
  .bio {
    margin-top: 22px;
    border-left: 2px solid var(--teal);
    padding: 4px 0 4px 22px;
    color: var(--text-dim);
    font-size: 15px;
    line-height: 1.6;
    max-width: 60ch;
  }
  .bio strong { color: var(--text); font-weight: 600; }

  /* ── Final CTA ────────────────────────────────────────── */
  .cta-block {
    margin-top: 36px;
    border: 1px solid rgba(111,177,172,0.28);
    border-radius: 18px;
    padding: 36px 30px;
    background:
      radial-gradient(140% 100% at 0% 100%, rgba(111,177,172,0.10) 0%, rgba(111,177,172,0) 60%),
      var(--ink-3);
    display: flex; align-items: center; justify-content: space-between;
    gap: 24px; flex-wrap: wrap;
    box-shadow: 0 18px 36px rgba(0,0,0,0.4);
  }
  .cta-block h3 {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 400; font-size: 26px; line-height: 1.2;
    color: var(--text); margin: 0 0 6px;
  }
  .cta-block p {
    color: var(--text-dim); font-size: 14px; margin: 0;
  }

  /* ── Footer ───────────────────────────────────────────── */
  footer {
    border-top: 1px solid var(--hair);
    padding: 28px 0 36px;
    color: var(--text-faint); font-size: 12px;
    display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px;
  }
  footer a { color: var(--text-dim); text-decoration: none; }
  footer a:hover { color: var(--text); }
</style>
</head>
<body>

<div class="wrap">

<nav class="nav">
  <div class="brand"><span class="brand-mark"></span>Trip Logger</div>
  <a class="nav-cta" href="${mailtoHref}">Book a demo</a>
</nav>

<header class="hero">
  <div class="kicker">Software for whale-watch operators</div>
  <h1>Every trip becomes <em>your marketing</em>.</h1>
  <p class="lede">
    Captain logs sightings on the boat. Trip Logger turns each one into a branded PDF for the company, a personalized email for every guest, and a live sightings widget for your website — automatically, the moment the trip ends.
  </p>
  <div class="hero-ctas">
    <a class="btn-primary" href="${mailtoHref}">Book a demo</a>
    <a class="btn-secondary" href="#demo">See it live</a>
  </div>
</header>

<section>
  <div class="section-label">What you get</div>
  <h2 class="section-h2">One trip in, three deliverables out.</h2>
  <p class="section-lede">
    The captain hits "End Trip." The system does the rest before they've even tied up at the dock.
  </p>
  <div class="threecol">
    <div class="card">
      <div class="card-num">01</div>
      <div class="card-h">A branded trip report</div>
      <p class="card-p">PDF with your logo, the map, every sighting, depth, conditions, and the captain's notes. Sent to every guest's inbox.</p>
    </div>
    <div class="card">
      <div class="card-num">02</div>
      <div class="card-h">A personalized email</div>
      <p class="card-p">Each guest gets a hand-written-feeling note — name, species they saw, trip count with you. Adds them to your Mailchimp list automatically.</p>
    </div>
    <div class="card">
      <div class="card-num">03</div>
      <div class="card-h">A live sightings log</div>
      <p class="card-p">Embed code for your website. Fresh sighting data every trip — exactly the content Google rewards. Shareable IG story card too.</p>
    </div>
  </div>
</section>

<section>
  <div class="section-label">Why operators care</div>
  <h2 class="section-h2">Built around the things that grow a whale-watch business.</h2>
  <div class="features">
    <div>
      <div class="feature-h"><span class="feature-dot"></span>Captain audio recap</div>
      <p class="feature-p">A 60-second narrated summary of the trip plays inside the report and on the public widget. No other operator platform offers it. Guests share these.</p>
    </div>
    <div>
      <div class="feature-h"><span class="feature-dot"></span>Per-guest personalization</div>
      <p class="feature-p">"Hi Sarah, you've now seen 4 species across 2 trips with us…" — open rates 2-3× what generic newsletters get. The system tracks every guest's history with you.</p>
    </div>
    <div>
      <div class="feature-h"><span class="feature-dot"></span>SEO-friendly sightings widget</div>
      <p class="feature-p">Fresh species data on your website indexed by Google. Ranks for the high-intent queries your competitors don't ("humpback Monterey Bay this week"). Bookings adjacent.</p>
    </div>
    <div>
      <div class="feature-h"><span class="feature-dot"></span>FareHarbor integration</div>
      <p class="feature-p">Pulls your booking data and pre-fills trip details — passenger count, guest names, emails. No double entry. Works the moment your captain hits Start.</p>
    </div>
    <div>
      <div class="feature-h"><span class="feature-dot"></span>Designed for the boat</div>
      <p class="feature-p">PWA that works offline. Touch-first. One captain, one phone, one tap to log. No tablet, no second hand needed at the wheel.</p>
    </div>
    <div>
      <div class="feature-h"><span class="feature-dot"></span>Your data, your brand</div>
      <p class="feature-p">All emails come from your address. Your logo, your colors, your booking links. We're invisible to your guests — your brand owns the experience.</p>
    </div>
  </div>
</section>

<section id="demo">
  <div class="section-label">See it live</div>
  <h2 class="section-h2">This is Enocean Tours' real sightings widget.</h2>
  <p class="section-lede">
    Captain Slater logs every Enocean trip in Trip Logger. The widget below updates the moment a trip ends — same one embedded on <a href="https://enoceantours.com" target="_blank" rel="noopener" style="color:var(--teal);text-decoration:none;border-bottom:1px solid rgba(111,177,172,0.4);">enoceantours.com</a>. Your version is branded for your company.
  </p>
  <div class="demo-frame">
    <div class="demo-chrome">
      <div class="demo-chrome-dots">
        <span class="demo-chrome-dot"></span>
        <span class="demo-chrome-dot"></span>
        <span class="demo-chrome-dot"></span>
      </div>
      <span class="demo-url">enoceantours.com/sightings</span>
    </div>
    <iframe src="${widgetSrc}" loading="lazy" title="Live sightings widget — Enocean Tours"></iframe>
  </div>
</section>

<section>
  <div class="section-label">Who built this</div>
  <h2 class="section-h2">A captain who got tired of writing the same email after every trip.</h2>
  <div class="bio">
    <strong>Slater Moore</strong> runs Enocean Tours out of Moss Landing Harbor on Monterey Bay. He built Trip Logger after a season of hand-writing personalized recap emails to every guest, every night. The platform now handles that for him — and is being offered to other operators who want the same leverage without learning to code.
  </div>
</section>

<div class="cta-block">
  <div>
    <h3>Want this for your operation?</h3>
    <p>A 30-minute call walks through your boat, your bookings, and what your branded version would look like.</p>
  </div>
  <a class="btn-primary" href="${mailtoHref}">Book a demo</a>
</div>

<footer>
  <div>© Trip Logger · Built by <a href="https://enoceantours.com" target="_blank" rel="noopener">Enocean Tours</a></div>
  <div><a href="${mailtoHref}">${contactEmail}</a></div>
</footer>

</div>

</body>
</html>`);
};
