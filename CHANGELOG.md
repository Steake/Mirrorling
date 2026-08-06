# Changelog

All notable changes are recorded here. Versions follow Semantic Versioning while the project remains in release-candidate development.

## 1.2.0-rc.1 — 2026-08-06

### Added

- The Mirrorling brand, original mascot, repository icon and GitHub masthead artwork.
- The primary browser API at `window.__MIRRORLING__`, with the previous internal name retained as a compatibility alias.
- Modern Netlify Functions runtime mounted at the original request path.
- Shared Fetch-based proxy path for immutable hosting deployments.
- Netlify parity tests for overlays, mocks, script overrides, authentication, redirects and production handover.
- Local release-candidate gates, repository hygiene checks, extracted-bundle smoke testing and a full browser sign-off gate.
- GitHub publication, contribution, security and release documentation.

### Changed

- Renamed the project from Production Overlay Bench to Mirrorling and rebuilt the publication README around its bounded-intervention model.
- Raised the supported Node.js floor to 22.13.0 to match the tested Netlify toolchain.
- Pinned TypeScript to the stable 5.9 line for Netlify bundler compatibility.
- Kept the Netlify CLI outside the dependency graph while pinning the invoked version.
- Added a committed empty baseline configuration and embedded it in the Netlify function build.

### Security

- Enforced staging authentication on Node WebSocket upgrades and stripped Mirrorling credentials, scenario controls and internal cookies before proxying them upstream.

### Runtime boundary

- Netlify deployments are immutable HTTP mirrors. Inspector scaffolding, file writes, live reload and WebSocket proxying remain features of the local Node authoring runtime.

## 1.1.0 — 2026-08-05

- Added the selector inspector, Handlebars element templates and selector contracts.
- Separated independent injected JavaScript from production script overrides.
- Added local scaffolding, live reload and authoring-focused integration tests.

## 1.0.0 — 2026-08-04

- Added scenario-driven production mirroring, HTML overlays, route mocks and explicit client-side handover.
