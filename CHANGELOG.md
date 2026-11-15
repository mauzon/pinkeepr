# Changelog

All notable changes to the **pinkeepr** template are documented here.

## Unreleased

### Optional Cloudflare D1 + API (opt-in)

- **`config.json` → `storage`:** `"json"` (default when omitted) or `"d1"`. JSON mode is unchanged: static build from `data/cities/*.json`, deploy to any static host with no Worker, Wrangler, or secrets.
- **D1 mode:** Worker + D1 via `wrangler.d1.example.jsonc` (copy locally to `wrangler.d1.jsonc`). See **[DEPLOY-D1.md](DEPLOY-D1.md)**.
- **Migrations:** `npm run d1:seed` (JSON → D1), `npm run d1:export` (D1 → `data/cities/*.json`).
- **Tests:** `npm run test:d1` for API/D1 paths; default CI still builds JSON mode.

**If you already forked pinkeepr (JSON / static mode): nothing to do.** Your site keeps working as today. To enable the database later, see [DEPLOY-D1.md](DEPLOY-D1.md).

**Updating from upstream:** pinkeepr `main` was squashed into a single `init` commit. Older forks may see “unrelated histories” when pulling. See README → [Updating your fork](#updating-your-fork).