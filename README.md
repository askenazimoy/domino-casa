# Contador de Dominó (sincronizado)

App web para llevar la cuenta del dominó (101 puntos pierde). Funciona offline, sincroniza entre todos los teléfonos de la casa cada 3-5 segundos.

## Arquitectura

- **Vercel** sirve el HTML estático + la función serverless `/api/state`.
- **Supabase** guarda un único registro JSON con el estado completo de la casa (jugadores, partida actual, historial).
- **Cliente** lee al cargar, escribe debounced cada vez que cambias algo, hace polling cada 4 segundos para detectar cambios de otros.

```
┌──────────┐         ┌──────────┐          ┌──────────┐
│  iPhone  │ ─POST─▶ │ /api/    │ ─upsert▶ │ Supabase │
│  Safari  │ ◀─GET── │ state.js │ ◀select─ │ Postgres │
└──────────┘         └──────────┘          └──────────┘
   (otros teléfonos hacen lo mismo, polling cada 4s)
```

## Setup paso a paso

### 1. Supabase: crear la tabla

En tu proyecto de Supabase → SQL Editor → New query → pega el contenido de [`supabase-schema.sql`](./supabase-schema.sql) y dale Run. Esto crea la tabla `domino_state` con una sola fila (`id = 'main'`) y un trigger para actualizar `updated_at`.

### 2. Sacar las credenciales

En Supabase → Project Settings → API copia:
- `Project URL` (algo como `https://xyz.supabase.co`)
- `service_role` key (la "secreta", **no** la `anon`)

⚠️ La `service_role` key bypassa RLS. Mantenla solo del lado del servidor, **nunca** la pongas en código del cliente.

### 3. Subir el repo a GitHub

```bash
git init
git add .
git commit -m "Contador de dominó con sync"
gh repo create domino-contador --private --source=. --push
```

(o como acostumbres crear repos)

### 4. Importar a Vercel

En vercel.com → Add New → Project → importa el repo. **No** necesita configuración de build — es estático más una función serverless en `/api`.

Antes de desplegar, en Vercel → Settings → Environment Variables agrega:

| Name | Value |
|------|-------|
| `SUPABASE_URL` | la Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | la service_role key |

Aplica a Production, Preview y Development.

### 5. Deploy

Vercel deployea solo al hacer push. Te da un URL tipo `https://domino-contador.vercel.app`. Compártelo en el grupo de WhatsApp y todos verán los mismos stats.

## Probarlo en local (opcional)

```bash
npm install
npm install -g vercel
vercel dev
```

Llena `.env` (copia de `.env.example`) con tus credenciales reales y abre `http://localhost:3000`.

## Instalar como app en iPhone

1. Abre el URL de Vercel en Safari (debe ser https://)
2. Botón de Compartir → "Añadir a pantalla de inicio"
3. Listo, queda con icono propio y abre en pantalla completa

## Detalles técnicos

**Modelo de datos.** Todo cabe en un solo blob JSON porque el volumen es mínimo:
```json
{
  "roster": [{ "id", "name", "wins", "losses", "games", "zapatos", "zapatosRecibidos" }],
  "currentGame": { "team1", "team2", "startedAt", "lastTeam" } | null,
  "history": [{ "id", "endedAt", "team1", "team2", "winner" }, ...]
}
```

**Sincronización.** Last-write-wins. Si dos teléfonos editan simultáneamente, el último POST gana. Para un contador de dominó (donde usualmente uno solo lleva la cuenta) esto no importa. Si quisieras edición concurrente robusta tendrías que ir a OT / CRDT, total overkill aquí.

**Offline.** La app guarda en `localStorage` también, así que si pierdes señal sigue funcionando — al recuperar conexión sube los cambios.

**Polling.** Cada 4 segundos pide solo `updated_at` (payload chiquito, ~30 bytes) y solo si cambió hace el fetch completo. Cuando el tab está oculto pausa el polling. Cuando vuelve al frente, sincroniza inmediatamente.

**Tier gratis de Supabase.** 500MB DB + 2GB transferencia / mes. Esta app usa kilobytes. Estás a salvo.

**Tier gratis de Vercel.** 100GB ancho de banda y funciones serverless suficientes para uso personal. También a salvo.

## Si quieres más adelante

- **Salas con código** (varios grupos comparten la misma app, cada uno con su casa): cambiar el `ROW_ID` fijo por un parámetro `?casa=xxx`.
- **Realtime de Supabase** (instant en vez de polling): suscripción WebSocket de 1 línea, reemplaza el `setInterval`.
- **Cuentas con login**: Supabase Auth + RLS por usuario.
- **Columna ZR** en las tablas (zapatos recibidos) — ya se trackea, solo falta pintarla.

## Archivos

- `index.html` — la app completa (un solo archivo, sin build step)
- `api/state.js` — función serverless de Vercel (GET y POST)
- `supabase-schema.sql` — el SQL a correr una vez
- `package.json` — solo declara la dependencia de `@supabase/supabase-js`
- `vercel.json` — config mínima de Vercel
