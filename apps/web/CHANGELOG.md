# Changelog — @qzr/web

All notable changes to the web portal (coach roster management, admin dashboard) are documented
here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Released via `.github/workflows/deploy-web.yml` (Cloudflare Pages, project `versevault-www`) on
every `version` bump in `apps/web/package.json` that lands on `master`. The same workflow also
deploys when `apps/scoresheet/package.json` bumps, because the web Pages site bundles the scoresheet
PWA build under `/scoresheet/`.

The portal shipped as part of the unified monorepo versioning era under tags `v0.2.0`–`v0.9.1`; see
[`apps/scoresheet/CHANGELOG.md`](../scoresheet/CHANGELOG.md) for historical entries that covered the
portal. This per-package changelog starts fresh from 0.9.1 as the baseline.

## [Unreleased]
