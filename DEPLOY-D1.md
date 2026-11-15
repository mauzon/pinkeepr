# Deploying optional D1 + API (pinkeepr)

This adds a Cloudflare Worker + D1 backend **without** replacing the default static/json fork. Keep `wrangler.jsonc` assets-only until you deliberately switch.

## Storage modes

| `config.json` | Build / env | Frontend | Backend |
|---------------|-------------|----------|---------|
| `"storage": "json"` (default) | `npm run build` | Reads `/data/cities/*.json` | None |
| `"storage": "d1"` | `STORAGE=d1 npm run build` or CI non-`main` | Fetches `/api/cities/*` | Worker + D1 |

Legacy `dataSource: "static"|"api"` is still read at build time (`api` → `d1`, `static` → `json`).

## Wrangler configs

- **Static / JSON (default):** `wrangler.jsonc` — assets only, no Worker script.
- **D1 + API:** copy `wrangler.d1.example.jsonc` → `wrangler.d1.jsonc`, create D1 (`wrangler d1 create pinkeepr-places`), paste `database_id`, deploy with `wrangler deploy -c wrangler.d1.jsonc`.

`assets.run_worker_first` must include `/api/*` so API routes hit the Worker before the static 404 handler.

## Workers Builds (preview branch)

| Step | Command |
|------|---------|
| Build | `npm run validate && npm run build` (or `npm run build:d1`) |
| Preview deploy | `npx wrangler deploy -c wrangler.d1.jsonc` (or your preview command) |

The build sets **`storage: "d1"`** when `STORAGE=d1`, `WORKERS_CI`/`CI` on a non-`main` branch, or `config.json` → `"storage": "d1"`.

## D1 database

1. `npx wrangler d1 create pinkeepr-places`
2. Update `database_id` in `wrangler.d1.jsonc`
3. `npm run d1:seed` (loads `data/cities/*.json` — use `npm run demo:london` first for the public demo pack)
4. Optional: `npm run d1:seed-sql` → `migrations/seed/seed.sql` for remote bulk load (do not commit real trip SQL)

Migrations **0001–0003** live in `migrations/`. Binding name: **`DB`**.

## Vars (plain text in wrangler.d1.jsonc)

| Var | Purpose |
|-----|---------|
| `ACCESS_TEAM_DOMAIN` | Your Cloudflare Access team domain |
| `ACCESS_AUD` | Access application AUD (comma-separated if multiple) |
| `ACCESS_BYPASS_DEV` | `true` locally only (`.dev.vars`) |
| `WRITE_EMAILS` | Allowlisted emails for JWT writes |
| `AGENT_TOKEN_HASHES` | JSON `{"agent-name":"<sha256-hex>"}` |

Generate a token hash:

```bash
npm run agent-token -- demo
```

The command prints the token once and updates `wrangler.d1.jsonc` (or `wrangler.d1.example.jsonc` if no local copy).

Optional secrets: `AGENT_TOKENS`, overriding `ACCESS_AUD` / `WRITE_EMAILS`.

## Local development

```bash
cp .dev.vars.example .dev.vars   # ACCESS_BYPASS_DEV=1
npm run demo:london
npm run build:d1
npx wrangler dev -c wrangler.d1.jsonc
```

## Checks

```bash
npm run test:d1
npm run validate && npm run build:d1
```

## Production vs preview

- **`main`** with default `wrangler.jsonc` stays a static site (no `/api`).
- A branch with `wrangler.d1.jsonc` and `storage: "d1"` preview uses Worker + shared D1 when configured.