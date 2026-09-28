// Vercel serverless function: GET and POST the shared state per "casa".
// Storage: Neon Postgres via @neondatabase/serverless.
//
// Each casa is a single row in domino_state keyed by id = casa code.
// Casa codes: lowercase a-z, 0-9, hyphens, 3-30 chars.

import { neon } from '@neondatabase/serverless';

const DEFAULT_CASA = 'main';
const CASA_RE = /^[a-z0-9-]{3,30}$/;

// Vercel's Neon integration provides POSTGRES_URL (pooled).
// Non-pooled is fine here since we do at most one query per invocation.
const sql = neon(process.env.POSTGRES_URL || process.env.DATABASE_URL);

// Self-heal schema on first request per cold start. Idempotent, cheap.
let schemaReady = null;
async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS domino_state (
      id text PRIMARY KEY,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  })();
  return schemaReady;
}

function resolveCasa(req) {
  const raw = (req.query && req.query.casa) || DEFAULT_CASA;
  const casa = String(raw).toLowerCase().trim();
  return CASA_RE.test(casa) ? casa : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const casa = resolveCasa(req);
  if (!casa) {
    return res.status(400).json({ error: 'Invalid casa code (use 3-30 chars: a-z, 0-9, -)' });
  }

  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const checkOnly = req.query && req.query.check;

      const rows = checkOnly
        ? await sql`SELECT updated_at FROM domino_state WHERE id = ${casa} LIMIT 1`
        : await sql`SELECT data, updated_at FROM domino_state WHERE id = ${casa} LIMIT 1`;

      if (!rows || rows.length === 0) {
        return res.json({ casa, data: {}, updated_at: null });
      }
      const row = rows[0];
      if (checkOnly) return res.json({ casa, updated_at: row.updated_at });
      return res.json({ casa, data: row.data || {}, updated_at: row.updated_at });
    }

    if (req.method === 'POST') {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'Invalid body' });
      }
      const size = JSON.stringify(body).length;
      if (size > 500_000) {
        return res.status(413).json({ error: 'Payload too large (>500KB)' });
      }

      // Upsert: insert new casa or update the existing one.
      // updated_at trigger on the table handles the timestamp.
      const rows = await sql`
        INSERT INTO domino_state (id, data)
        VALUES (${casa}, ${JSON.stringify(body)}::jsonb)
        ON CONFLICT (id) DO UPDATE
          SET data = EXCLUDED.data, updated_at = now()
        RETURNING updated_at
      `;
      return res.json({ ok: true, casa, updated_at: rows[0].updated_at });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
