// Thin proxy in front of Google Static Maps so the API key stays server-side.
// The captain card canvas in index.html fetches a map image from this endpoint
// and draws it onto the IG Story canvas. Same-origin so no CORS dance needed.
//
// Query params:
//   center  e.g. "36.78,-122.05"  (default: Monterey Bay)
//   zoom    e.g. "10"             (default: 10)
//   size    e.g. "640x400"        (default: 640x400, scale=2 -> 1280x800 actual)
//   maptype "hybrid" | "roadmap" | "satellite" | "terrain"  (default: hybrid)
//   markers repeated, each value passed through verbatim, e.g.
//             markers=color:white|label:1|36.78,-122.05
//
// Anything not in the allowlist is dropped, so callers can't smuggle through
// arbitrary Static Maps params (style overrides, signed-URL bypasses, etc.)
// or bloat our Google quota with very large image requests.

const https = require('https');

const ALLOWED_MAPTYPES = new Set(['hybrid', 'roadmap', 'satellite', 'terrain']);

function clampSize(raw) {
  if (typeof raw !== 'string') return '640x400';
  const m = raw.match(/^(\d{2,4})x(\d{2,4})$/);
  if (!m) return '640x400';
  const w = Math.min(parseInt(m[1], 10), 640);
  const h = Math.min(parseInt(m[2], 10), 640);
  return `${w}x${h}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    res.status(500).send('GOOGLE_MAPS_API_KEY not configured');
    return;
  }

  const q = req.query || {};
  const params = new URLSearchParams();
  params.set('center', typeof q.center === 'string' ? q.center : '36.78,-122.05');
  params.set('zoom', typeof q.zoom === 'string' && /^\d{1,2}$/.test(q.zoom) ? q.zoom : '10');
  params.set('size', clampSize(q.size));
  params.set('scale', '2');
  params.set('maptype', ALLOWED_MAPTYPES.has(q.maptype) ? q.maptype : 'hybrid');

  const markers = Array.isArray(q.markers) ? q.markers : (q.markers ? [q.markers] : []);
  markers.slice(0, 25).forEach(m => {
    if (typeof m === 'string') params.append('markers', m);
  });

  params.set('key', key);

  const url = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;

  https.get(url, (upstream) => {
    if (upstream.statusCode !== 200) {
      res.status(upstream.statusCode || 502).send('Upstream Static Maps error');
      upstream.resume();
      return;
    }
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/png');
    // Maps for a given trip never change — let the browser cache aggressively
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    upstream.pipe(res);
  }).on('error', (err) => {
    res.status(502).send('Failed to reach Static Maps: ' + err.message);
  });
};
