// Vercel serverless function: GET and POST the shared "casa" state.
// Uses the Supabase service role key, which is server-side only.

import { createClient } from '@supabase/supabase-js';

const ROW_ID = 'main';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export default async function handler(req, res) {
  // No-cache so polling always sees fresh data
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    if (req.method === 'GET') {
      // Quick check mode: ?check=1 returns only updated_at for cheap polling
      const checkOnly = req.query && req.query.check;

      const cols = checkOnly ? 'updated_at' : 'data, updated_at';
      const { data, error } = await supabase
        .from('domino_state')
        .select(cols)
        .eq('id', ROW_ID)
        .maybeSingle();

      if (error) return res.status(500).json({ error: error.message });

      if (!data) {
        // Row not seeded — return empty defaults
        return res.json({ data: {}, updated_at: null });
      }

      if (checkOnly) return res.json({ updated_at: data.updated_at });
      return res.json({ data: data.data || {}, updated_at: data.updated_at });
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
          { id: ROW_ID, data: body, updated_at: new Date().toISOString() },
          { onConflict: 'id' }
        )
        .select('updated_at')
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true, updated_at: data.updated_at });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
