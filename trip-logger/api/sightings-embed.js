// GET /api/sightings-embed.js?op=<slug> — script-tag embed of the sightings widget.
//
// SEO companion to /api/sightings (the iframe widget). Returns a self-
// contained JS file that, when included on an operator's page via:
//
//   <div data-tl-sightings></div>
//   <script src="https://trip-logger-backend.vercel.app/api/sightings-embed.js?op=<slug>" async></script>
//
// ...mounts the same widget HTML directly into the operator's DOM (inside an
// open Shadow Root for style isolation) instead of inside an iframe. Crawlers
// then index the sightings content as part of the operator's page, which the
// iframe version blocks. Visually identical for end users.
//
// We re-serve the existing sightings-widget.html content with three small
// transforms applied so it runs inside a shadow root:
//   - The `html, body { ... }` background gets re-targeted to a host wrapper.
//   - `document.getElementById/querySelector(All)` calls in the widget script
//     are rewritten to operate on the shadow root.
//   - The hardcoded `L.map('sightings-map', ...)` call is rewritten to pass
//     the actual element, since Leaflet looks up IDs via document and would
//     not find the element behind the shadow boundary.
//
// Iframe-only behaviour (postMessage iframe height auto-resize) is short-
// circuited — irrelevant for inline embeds and would error since window.parent
// === window in this context.

const fs = require('fs');
const path = require('path');

const DEFAULT_SLUG = 'enocean';

async function loadOperatorConfig(slug) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return { id: null, slug, show_map_on_widget: true };
  try {
    const safeSlug = encodeURIComponent(slug);
    const res = await fetch(
      `${url}/rest/v1/operators?slug=eq.${safeSlug}&select=id,slug,show_map_on_widget&limit=1`,
      { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } }
    );
    if (!res.ok) return { id: null, slug, show_map_on_widget: true };
    const rows = await res.json();
    const row = rows[0];
    if (!row) return { id: null, slug, show_map_on_widget: true };
    return {
      id: row.id,
      slug: row.slug,
      show_map_on_widget: row.show_map_on_widget !== false,
    };
  } catch (e) {
    console.error('sightings-embed: operator lookup failed:', e.message);
    return { id: null, slug, show_map_on_widget: true };
  }
}

// Extracts <style> blocks (concatenated), <body> innerHTML, and inline
// <script> contents from the widget HTML. We deliberately don't touch
// external <link>/<script src=...> tags — those (Leaflet, fonts) are
// re-added at mount time by the embed loader so they live in the host
// document head, not the shadow root.
function parseWidget(html) {
  const styles = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi))
    .map(m => m[1])
    .join('\n');

  const inlineScripts = Array.from(html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi))
    .map(m => m[1])
    .join('\n');

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let body = bodyMatch ? bodyMatch[1] : '';
  // Strip <script> tags from the body — we re-emit them through the
  // shadow-root scoping wrapper below.
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '').trim();

  return { styles, body, inlineScripts };
}

function shadowSafeStyles(rawCss) {
  // The widget's CSS includes an `html, body { ... }` rule that owns the
  // page-wide background gradient. Inside a shadow root, neither selector
  // matches anything — we wrap our mounted content in `.tl-widget-host`
  // and retarget the rule onto that. Match conservatively to avoid eating
  // other rules.
  return rawCss.replace(
    /html\s*,\s*body\s*\{([\s\S]*?)\}/,
    '.tl-widget-host {$1}',
  );
}

function shadowSafeScript(rawJs) {
  // Rewrite document lookups to use the shadow root. Order matters:
  // querySelectorAll before querySelector, and we leave document.* calls
  // that aren't lookups (e.g., document.createElement) alone.
  let js = rawJs;
  js = js.replace(/\bdocument\.querySelectorAll\(/g, '__tlRoot.querySelectorAll(');
  js = js.replace(/\bdocument\.querySelector\(/g,    '__tlRoot.querySelector(');
  js = js.replace(/\bdocument\.getElementById\(/g,   '__tlRoot.getElementById(');
  // Leaflet's L.map() with a string ID looks the element up via document,
  // which can't reach into shadow roots. Pass the resolved element directly.
  js = js.replace(
    /L\.map\(\s*'sightings-map'\s*,/g,
    "L.map(__tlRoot.getElementById('sightings-map'),",
  );
  // The widget posts height messages to its parent frame for iframe auto-
  // resize. Inline embeds size to their content naturally, so neuter that
  // function — leaving it active would also throw when window.parent === window.
  js = js.replace(/window\.parent\.postMessage\(\{[^}]*iframeHeight[^}]*\}[^)]*\);/g, '/* iframe-only */');
  return js;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  // Public-cacheable for a minute — Supabase data is the slow part, the
  // wrapper around it changes only on deploy.
  res.setHeader('Cache-Control', 'public, max-age=60');

  try {
    const slug = (req.query && req.query.op) || DEFAULT_SLUG;
    const opConfig = await loadOperatorConfig(slug);

    const filePath = path.join(__dirname, 'sightings-widget.html');
    const html = fs.readFileSync(filePath, 'utf8');
    const { styles, body, inlineScripts } = parseWidget(html);
    const safeCss = shadowSafeStyles(styles);
    const safeJs  = shadowSafeScript(inlineScripts);

    // Serialize untrusted strings safely. JSON.stringify covers backslashes
    // and quotes; the `</` substitution keeps a literal `</script>` inside
    // any payload from terminating the embedding host page's script tag,
    // and the trailing slash on `<!` blocks HTML-comment-style breakouts.
    const safe = s => JSON.stringify(s)
      .replace(/<\/(?=script)/gi, '<\\/')
      .replace(/<!--/g, '<\\!--');

    const out = `(function () {
  // sightings-embed.js — script-tag mount of the public sightings widget.
  // SEO companion to /api/sightings (iframe). Same UI, same data, but
  // rendered into the host page's DOM (inside an open Shadow Root) so
  // search engines index the sightings content on the operator's domain.

  var __tlScript = document.currentScript;
  if (!__tlScript) return;

  // Mount target: the operator drops a <div data-tl-sightings> on their page.
  // If they forgot, we inject one right above the script tag so the widget
  // still appears in the right spot — degrades gracefully.
  var target = document.querySelector('[data-tl-sightings]');
  if (!target) {
    target = document.createElement('div');
    target.setAttribute('data-tl-sightings', '');
    __tlScript.parentNode.insertBefore(target, __tlScript);
  }
  if (target.shadowRoot) return; // already mounted (script included twice)

  var __tlRoot = target.attachShadow({ mode: 'open' });

  // Operator scope is resolved server-side, baked into the bundle.
  window.__OP_CONFIG = ${safe(opConfig)};

  var STYLES = ${safe(safeCss)};
  var BODY   = ${safe(body)};
  var WIDGET_SCRIPT = ${safe(safeJs)};

  // Inject fonts + Leaflet CSS into the host document head ONCE. Fonts
  // outside the shadow root are fine — \`@font-face\` is global by design
  // and Shadow DOM doesn't isolate it anyway. Same for Leaflet's tile-pane
  // styles, which sit on the global window.
  function addOnce(selector, build) {
    if (document.head.querySelector(selector)) return;
    document.head.appendChild(build());
  }
  addOnce('link[data-tl-fonts]', function () {
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;1,9..144,400&family=JetBrains+Mono:wght@400;500&family=Open+Sans:wght@400;500;600;700&display=swap';
    l.dataset.tlFonts = '1';
    return l;
  });

  function loadLeaflet(cb) {
    if (window.L) { cb(); return; }
    addOnce('link[data-tl-leaflet]', function () {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      l.dataset.tlLeaflet = '1';
      return l;
    });
    var s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = cb;
    s.onerror = function () { console.error('sightings-embed: failed to load Leaflet'); cb(); };
    document.head.appendChild(s);
  }

  // Shadow DOM blocks the parent page's CSS — so we also need to inject a
  // copy of Leaflet's CSS *inside* the shadow root, or pin markers and tile
  // grid wouldn't pick up its rules. The widget's own styles ride on top.
  function buildShadow() {
    __tlRoot.innerHTML =
      '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">' +
      '<style>' + STYLES + '</style>' +
      '<div class="tl-widget-host">' + BODY + '</div>';

    // Execute the widget's inline script with __tlRoot in scope. We use the
    // Function constructor rather than appending a <script> tag so the
    // shadow-root references resolve to OUR closure variable. This is the
    // same pattern as new Function(...) — keeps the widget JS isolated
    // from the host page's globals except for the few it needs (window.L,
    // window.__OP_CONFIG).
    try {
      new Function('__tlRoot', WIDGET_SCRIPT)(__tlRoot);
    } catch (err) {
      console.error('sightings-embed: widget script crashed:', err);
    }
  }

  loadLeaflet(buildShadow);
})();
`;

    res.status(200).send(out);
  } catch (err) {
    res.setHeader('Content-Type', 'text/plain');
    res.status(500).send('Error: ' + err.message);
  }
};
