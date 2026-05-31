// Vercel serverless function: GET and POST the shared state per "casa".
// Uses the Supabase service role key, which is server-side only.
//
// Each casa is a single row in domino_state keyed by id = casa code.
// Casa codes: lowercase a-z, 0-9, hyphens, 3-30 chars.

import { createClient } from '@supabase/supabase-js';

const DEFAULT_CASA = 'main';
const CASA_RE = /^[a-z0-9-]{3,30}$/;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function resolveCasa(req) {
  const raw = (req.query && req.query.casa) || DEFAULT_CASA;
  const casa = String(raw).toLowerCase().trim();
  return CASA_RE.test(casa) ? casa : null;
}

export default async function handler(req, res) {
  // No-cache so polling always sees fresh data
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const casa = resolveCasa(req);
  if (!casa) {
    return res.status(400).json({ error: 'Invalid casa code (use 3-30 chars: a-z, 0-9, -)' });
  }

  try {
    if (req.method === 'GET') {
      // Quick check mode: ?check=1 returns only updated_at for cheap polling
      const checkOnly = req.query && req.query.check;

      const cols = checkOnly ? 'updated_at' : 'data, updated_at';
      const { data, error } = await supabase
        .from('domino_state')
        .select(cols)
        .eq('id', casa)
        .maybeSingle();

      if (error) return res.status(500).json({ error: error.message });

      if (!data) {
        // Casa doesn't exist yet — return empty defaults
        return res.json({ casa, data: {}, updated_at: null });
      }

      if (checkOnly) return res.json({ casa, updated_at: data.updated_at });
      return res.json({ casa, data: data.data || {}, updated_at: data.updated_at });
    }

    if (req.method === 'POST') {
      // Body is already parsed JSON in Vercel Node functions
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'Invalid body' });
      }

      // Reject oversized payloads (sanity check — Supabase jsonb is generous but no point pushing huge blobs)
      const size = JSON.stringify(body).length;
      if (size > 500_000) {
        return res.status(413).json({ error: 'Payload too large (>500KB)' });
      }

      const { data, error } = await supabase
        .from('domino_state')
        .upsert(
          { id: casa, data: body, updated_at: new Date().toISOString() },
          { onConflict: 'id' }
        )
        .select('updated_at')
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true, casa, updated_at: data.updated_at });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
