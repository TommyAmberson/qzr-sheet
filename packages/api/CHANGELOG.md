# Changelog — @qzr/api

All notable changes to the API (Hono + Drizzle on Cloudflare Workers, D1 database) are documented
here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Released via `.github/workflows/deploy-api.yml` (D1 migrations apply + `wrangler deploy`) on every
`version` bump in `packages/api/package.json` that lands on `master`.

The API shipped as part of the unified monorepo versioning era under tags `v0.2.0`–`v0.9.1`; see
[`apps/scoresheet/CHANGELOG.md`](../../apps/scoresheet/CHANGELOG.md) for historical entries that
covered API changes. This per-package changelog starts fresh from 0.9.1 as the baseline.

Each release section must include a `### Bundled contract` subsection naming the current
`@qzr/shared` version. A mismatch between the version named here and what consumers ship is a real
wire/state compatibility signal — see CLAUDE.md "Contract package versioning".

## [Unreleased]
