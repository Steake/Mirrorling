# Security

## Supported version

Security fixes are made against the latest published release candidate until a stable release exists.

## Reporting a vulnerability

Use GitHub’s private vulnerability-reporting facility for the repository. Do not disclose credentials, customer data or an exploitable production target in a public issue.

Include the affected version, runtime (`node` or `netlify`), a minimal reproduction and the expected security boundary. Reports involving an arbitrary upstream target, leaked staging authentication, path traversal in scaffold writes, cross-origin handover or production credential forwarding receive priority.

## Deployment posture

Mirrorling deliberately renders and executes production material on a staging origin. Treat that origin as sensitive infrastructure.

- Protect remotely reachable deployments with access control.
- Store `BENCH_AUTH_USER` and `BENCH_AUTH_PASSWORD` as environment variables, never in configuration.
- Grant Netlify environment variables to the Functions scope when they are needed at runtime.
- Use a production origin you are authorised to proxy.
- Keep `security.disableServiceWorkers` enabled unless the consequences have been tested deliberately.
- Keep handover destinations on the configured production origin and allowlist every client-state key.
- Remember that query-carried state reaches servers and logs; prefer the fragment or `window.name` for state that production client code alone should consume.

Basic Auth is a practical gate, not an identity platform. Use network controls or a proper access proxy when the exposure warrants one.

## Explicit non-goals

The project does not transfer server-side sessions between staging and production, bypass production authentication, defeat bot protection or make unrelated origins share browser storage. Those are platform boundaries, not invitations to cleverness.
