# Contributing

Mirrorling is small enough to understand and dangerous enough to deserve care. A reverse proxy that almost preserves behaviour is merely a bug with excellent posture.

## Ground rules

- Keep baseline behaviour fail-open. A broken optional transformation should return the untouched production response where that is safe.
- Preserve the distinction between element overrides, independent injected JavaScript and production script overrides.
- Keep project configuration in JSON. Do not introduce YAML.
- Do not broaden the configured upstream into a user-controlled proxy target.
- Never send staging credentials, scenario controls or Mirrorling's internal cookies upstream.
- Add a regression test for every corrected defect.

## Local work

1. Use Node.js 22.13.0 or newer.
2. Run `npm ci`.
3. Run `npm run demo` for the self-contained production fixture and Mirrorling instance.
4. Use `npm run dev -- https://production.example/path` when authoring against a permitted production site.
5. Run `npm run rc:gate:core` before opening a pull request.

For browser sign-off, install Chromium once with `npx playwright install chromium`, then run `npm run rc:gate`.

## Pull requests

Keep each change narrow enough to review. Explain the production behaviour being preserved, the staging behaviour being introduced and the handover boundary, if any. Include the test that proves the distinction.

Do not commit `.env`, credentials, certificates, production customer data, browser traces containing secrets, `node_modules`, `dist`, `.netlify` or generated test reports.

The repository has no YAML workflow by design. The portable release gate is the authority; hosted CI can invoke it without changing what it means.
