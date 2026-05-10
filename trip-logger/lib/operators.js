// Loads a full operator row by id. Uses the service role key — bypasses RLS.
// Server endpoints call this AFTER authenticate() resolves the operatorId from
// a verified JWT, so the caller has already proven the user belongs to this
// operator before any per-operator data is touched.

async function getOperator(operatorId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !operatorId) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/operators?id=eq.${operatorId}&limit=1`,
      { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch (e) {
    console.error('getOperator error:', e.message);
    return null;
  }
}

// Returns an operator field, falling back to the given default if NULL/undefined.
// Used everywhere the server reads operator config so production keeps working
// while operator rows are still being filled in.
function pick(operator, field, fallback) {
  if (!operator) return fallback;
  const v = operator[field];
  return (v === null || v === undefined || v === '') ? fallback : v;
}

// Strip secrets out of an operator row before returning it to the client.
// /api/me uses this. Anything sensitive (API keys, passwords, OTA creds)
// stays server-only. UI-relevant fields are explicitly listed below.
function publicOperatorView(operator) {
  if (!operator) return null;
  return {
    id:                 operator.id,
    slug:               operator.slug,
    name:               operator.name,
    tagline:            operator.tagline,
    logo_url:           operator.logo_url,
    logo_url_email:     operator.logo_url_email,
    review_url:         operator.review_url,
    species_list:       operator.species_list || [],
    website_url:        operator.website_url,
    noaa_buoy_station:  operator.noaa_buoy_station,
    default_map_center: operator.default_map_center,
    default_map_zoom:   operator.default_map_zoom,
    from_email:         operator.from_email,
  };
}

module.exports = { getOperator, pick, publicOperatorView };
