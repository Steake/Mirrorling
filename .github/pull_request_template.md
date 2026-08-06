## What changed

Describe the change and the production behaviour it must preserve.

## Runtime boundary

- Node authoring runtime:
- Netlify immutable runtime:
- Production handover:

## Proof

- [ ] Regression test added or the reason none is required is explained
- [ ] `npm run rc:gate:core` passes
- [ ] `npm run rc:gate` passes when the change affects browser behaviour
- [ ] No credentials, certificates, customer data or generated artefacts are included
- [ ] Documentation and changelog are updated where behaviour changed
