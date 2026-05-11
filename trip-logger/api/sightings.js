// GET /api/sightings — serves the public sightings-widget.html.
//
// The widget needs a tiny amount of per-operator config (currently just
// show_map_on_widget). We look up that operator row server-side and inject
// it as `window.__OP_CONFIG` so the widget can read it synchronously at boot
// without an extra round-trip to Supabase and without exposing the operators
// table to the anon key.
//
// Operator is resolved from the `?op=<slug>` query param, falling back to
// the only active operator if a single one exists, or `enocean` as a final
// default. Once per-operator widget filtering ships, the same resolution
// will drive the data filter as well.

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
    console.error('sightings widget: operator lookup failed:', e.message);
    return { id: null, slug, show_map_on_widget: true };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/html');
  try {
    const slug = (req.query && req.query.op) || DEFAULT_SLUG;
    const opConfig = await loadOperatorConfig(slug);

    const filePath = path.join(__dirname, 'sightings-widget.html');
    let html = fs.readFileSync(filePath, 'utf8');

    const inject = `<script>window.__OP_CONFIG = ${JSON.stringify(opConfig)};</script>`;
    html = html.replace('</head>', `${inject}\n</head>`);

    res.status(200).send(html);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
};
