# Release Mirrorling without lying to yourself

Publication is the point at which private confidence meets public evidence. The repository already exists. The useful question is therefore no longer how to smuggle a ZIP file onto GitHub, but whether the commit being released has earned the version attached to it.

## Repository identity

| Field | Value |
| --- | --- |
| Repository | `Steake/Mirrorling` |
| Visibility | Public |
| Default branch | `main` |
| Description | Borrow a living production site, stage precise interventions, then hand the browser cleanly back. |
| Topics | `reverse-proxy`, `staging`, `testing`, `netlify`, `web-testing`, `experimentation`, `typescript`, `developer-tools` |
| Social preview | `docs/brand/mirrorling-social-preview.png` |

Keep the website field empty until a deployment deserves traffic. A blank field makes no claim; a dead URL makes one and loses.

## Candidate sequence

1. Begin from a clean checkout of `main`. Fetch before forming opinions about what `main` contains.
2. Confirm `package.json` and `CHANGELOG.md` describe the same intended version.
3. Run `npm ci` under Node.js 22.13.0 or newer.
4. Run `npm run rc:gate`. The core gate alone is insufficient for a browser-facing release.
5. Deploy an authenticated Netlify preview with `BENCH_UPSTREAM_ORIGIN` scoped to Functions.
6. Complete the manual deployment smoke test in [RELEASE.md](RELEASE.md), including the no-scenario baseline and same-tab production handover.
7. Tag the exact signed-off commit. Do not move a published tag to rescue an untidy morning.
8. Create a GitHub prerelease, copy the relevant changelog entry and attach the clean source archive when a hand-delivered artefact is useful.
9. Open the tag and release pages in a clean browser and verify that the commit, notes and assets agree.

The strict gate is executable policy. The deployment smoke test is contact with reality. Neither can deputise for the other.

## First release candidate

| Field | Value |
| --- | --- |
| Tag | `v1.2.0-rc.1` |
| Target commit | `019e4d0781dee4a5fc2c4b1abb3c71c3be44655f` |
| Release title | Mirrorling v1.2.0-rc.1 — Hijack production. Break nothing. |
| Release type | Prerelease |

### Release notes

> Mirrorling borrows a living production site through an independent staging origin, permits precise element overrides, independent JavaScript and production-script replacement, then hands the same browser tab cleanly back to production using client-side state alone.
>
> This first branded release candidate includes the local selector inspector and scaffolding workflow, JSON configuration, Netlify Functions support, staging authentication, explicit handover contracts, original project artwork and a strict release gate covering 24 unit and integration tests, the real Netlify bundle, dependency audit and two Playwright browser journeys.
>
> No scenario means the baseline mirror. No YAML means no YAML. Both are policy, not mood.

## Artefacts

Build release artefacts from the published tag or commit, never from an unexplained working directory.

- `mirrorling.zip` is the clean tracked source tree without Git metadata.
- `mirrorling-ready-to-push.zip` contains a complete checkout whose `main` follows the published repository.
- `mirrorling.bundle` is the portable Git fallback and must verify with `git bundle verify`.

Before distribution, test both ZIPs, verify the bundle and compare the social-preview SHA across all three source forms. An archive is not correct because its filename sounds reassuring.

## Repository government

- Protect `main` against deletion and force-pushes.
- Prefer linear, squashable changes small enough to review honestly.
- Keep Issues enabled; disable empty Wiki and Projects surfaces until they acquire a real purpose.
- Use GitHub private vulnerability reporting for security disclosures.
- Keep hosted workflow theatre out of the repository. The portable release gate remains authoritative, and authored YAML remains forbidden.

## Final prohibitions

- Do not commit `.env`, credentials, customer data, private certificates or browser traces containing secrets.
- Do not publish the package to npm; `private: true` is deliberate.
- Do not claim WebSocket or authoring parity on Netlify. Those remain local Node-runtime features.
- Do not treat a successful mirror of one friendly page as proof that every production application will cooperate.
- Do not soften the README into corporate porridge. There is enough of that already.
