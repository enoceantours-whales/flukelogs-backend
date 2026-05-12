// GET /api/embed-demo?op=<slug> — fake "operator homepage" that shows
// the script-tag embed of the sightings widget in context. Used to
// visually verify that the inline embed at /api/sightings-embed.js
// renders the same as the iframe at /api/sightings, without an iframe.
//
// Plain HTML page meant to simulate what an operator's marketing site
// would look like with the embed snippet copy-pasted in. Not linked
// from anywhere — handy URL to pass around for SEO discussions and
// regression-checks the embed against the iframe.

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const slug = String((req.query && req.query.op) || 'enocean')
    .toLowerCase().replace(/[^a-z0-9-]/g, '');
  const origin = `https://${req.headers.host}`;
  const embedSrc = `${origin}/api/sightings-embed.js?op=${slug}`;
  const iframeSrc = `${origin}/api/sightings?op=${slug}`;

  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Embed demo — ${slug}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500&family=Open+Sans:wght@400;600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: #f6f4ee;
    color: #1a1d20;
    font-family: "Open Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    font-size: 15px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  .fake-nav {
    border-bottom: 1px solid #d8d0c0;
    background: #fff;
  }
  .fake-nav-inner {
    max-width: 1080px;
    margin: 0 auto;
    padding: 18px 24px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .fake-brand { font-family: 'Fraunces', Georgia, serif; font-size: 22px; font-weight: 500; letter-spacing: -0.01em; color: #1a1d20; }
  .fake-nav-links { display: flex; gap: 24px; font-size: 13px; color: #6a6a5e; }
  .fake-hero {
    max-width: 1080px;
    margin: 0 auto;
    padding: 56px 24px 24px;
  }
  .fake-hero h1 {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 48px;
    font-weight: 300;
    line-height: 1.05;
    letter-spacing: -0.015em;
    color: #1a1d20;
  }
  .fake-hero p {
    margin-top: 14px;
    max-width: 620px;
    color: #4a4a3e;
    font-size: 17px;
  }
  .fake-section-label {
    max-width: 1080px;
    margin: 48px auto 0;
    padding: 0 24px;
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #8a7a5e;
    font-weight: 600;
  }
  .fake-section-h2 {
    max-width: 1080px;
    margin: 6px auto 0;
    padding: 0 24px;
    font-family: 'Fraunces', Georgia, serif;
    font-size: 32px;
    font-weight: 300;
    color: #1a1d20;
  }
  .embed-mount {
    max-width: 1080px;
    margin: 18px auto 0;
    padding: 0 24px 48px;
  }
  .iframe-mount {
    max-width: 1080px;
    margin: 0 auto;
    padding: 0 24px 64px;
  }
  .iframe-mount iframe {
    width: 100%;
    height: 1400px;
    border: 0;
    display: block;
  }
  .demo-note {
    max-width: 1080px;
    margin: 18px auto 0;
    padding: 18px 24px;
    background: #fffbe8;
    border-left: 3px solid #c8a86b;
    color: #6a5a3e;
    font-size: 13px;
    line-height: 1.55;
  }
  .demo-note code {
    background: #f0eadc;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 12px;
  }
  .fake-footer {
    border-top: 1px solid #d8d0c0;
    background: #fff;
    padding: 32px 24px;
    text-align: center;
    color: #8a7a5e;
    font-size: 12px;
  }
</style>
</head>
<body>

<nav class="fake-nav">
  <div class="fake-nav-inner">
    <div class="fake-brand">Enocean Tours</div>
    <div class="fake-nav-links"><span>Tours</span><span>Sightings</span><span>About</span><span>Book</span></div>
  </div>
</nav>

<section class="fake-hero">
  <h1>Whale watching on Monterey Bay.</h1>
  <p>Demo page simulating an operator's marketing site. The Sightings Log section below is mounted via a <code style="font-family:inherit;background:#e8e2d0;padding:1px 6px;border-radius:3px;font-size:14px;">&lt;script&gt;</code> tag — same widget content as the iframe, but rendered inline so search engines see it as part of this page.</p>
</section>

<div class="demo-note">
  <strong>What you're looking at:</strong> the top widget is the new <code>/api/sightings-embed.js</code> script-tag embed (SEO-friendly, content lives in this page's DOM). The bottom widget is the existing <code>/api/sightings</code> iframe, shown for visual comparison. They should look identical to a human and very different to Googlebot.
</div>

<div class="fake-section-label">Script embed · SEO-friendly</div>
<h2 class="fake-section-h2">Sightings Log</h2>
<div class="embed-mount">
  <div data-tl-sightings></div>
  <script src="${embedSrc}" async></script>
</div>

<div class="fake-section-label">Iframe embed · current production</div>
<h2 class="fake-section-h2">Sightings Log</h2>
<div class="iframe-mount">
  <iframe src="${iframeSrc}" title="Sightings (iframe)" loading="lazy"></iframe>
</div>

<footer class="fake-footer">© Demo page — not a real operator site.</footer>

</body>
</html>`);
};
