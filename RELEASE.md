# Release procedure

The release candidate gate is executable policy. Memory, confidence and a green-looking terminal from yesterday are not substitutes.

## Candidate definition

A candidate is eligible for sign-off only when all of the following are true:

- `package.json` carries the intended `-rc.N` version and `CHANGELOG.md` describes it.
- `npm ci` succeeds from a clean checkout.
- `npm run rc:gate` passes on Node.js 22.13.0 or newer.
- The Netlify bundle is produced from `netlify.toml` and the deployed function answers `/__bench/health`.
- A baseline request with no scenario selection mirrors production without experiment overlays.
- At least one scenario proves an element override, an independent injection and a production script override independently.
- A configured handover reaches the exact production origin, path and permitted client state.
- Basic Auth, if enabled, challenges at staging and does not reach production.
- The publication archive excludes credentials, build output, dependency folders and test artefacts.

## Gates

`npm run rc:gate:core` performs repository hygiene, type checking, unit and integration tests, the compiled Node build, a real Netlify function bundle, an invocation of that extracted bundle and a dependency audit. It is suitable for ordinary pull requests, but it is not browser sign-off.

Install the browser once with `npx playwright install chromium`. Then `npm run rc:gate` adds the complete Playwright journey and is the release authority.

The hygiene gate forbids authored YAML. This is deliberate. A hosted CI service may call the same command, but it does not get to invent a second catechism.

## Manual deployment smoke test

1. Create a Netlify deploy preview with `BENCH_UPSTREAM_ORIGIN` scoped to Functions.
2. Visit `/__bench/health` and confirm `runtime` is `netlify`, `authoring` is `false` and the upstream origin is correct.
3. Open an ordinary production path with no scenario parameter and compare its critical navigation and API behaviour.
4. Select the test scenario from `/__bench`, verify each intended override, then complete its production handover in the same browser tab.
5. Confirm WebSocket-dependent and over-limit flows are documented for the Node runtime rather than waved through as though hope were a transport protocol.

## Publication

Create the GitHub release from the signed-off commit, attach the clean source archive and copy the relevant changelog section into the release notes. [GITHUB.md](GITHUB.md) contains the repository identity, candidate sequence and first-release copy. Do not publish the package to npm; `private: true` exists to prevent that accident.
