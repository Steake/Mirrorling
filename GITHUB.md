# Put Mirrorling on GitHub from a phone

A laptop is convenient. It is not a constitutional requirement. The release candidate has already faced the machinery; your phone merely has to move it.

## Copy this into GitHub

| Field | Value |
| --- | --- |
| Repository name | `mirrorling` |
| Visibility | Public |
| Description | Borrow a living production site, stage precise interventions, then hand the browser cleanly back. |
| Topics | `reverse-proxy`, `staging`, `testing`, `netlify`, `web-testing`, `experimentation`, `typescript`, `developer-tools` |
| Default branch | `main` |
| First release tag | `v1.2.0-rc.1` |
| First release title | Mirrorling v1.2.0-rc.1 — under temporary management |
| Social preview | `docs/brand/mirrorling-social-preview.png` |

Leave the website field empty until there is a deployment worth sending people to. A vacant field is less embarrassing than a dead URL.

## The clean iPhone or iPad route

1. On GitHub, create an empty public repository named `mirrorling`. Do **not** ask GitHub to add a README, licence or `.gitignore`; all three already exist and duelling first commits are a tax on impatience.
2. Download `mirrorling-ready-to-push.zip` and tap it once in Files to extract it.
3. Move the extracted `mirrorling` directory into the Working Copy location in Files. It contains a complete Git repository on `main`, with the release-candidate commit already made.
4. In Working Copy, connect GitHub, add the empty repository as `origin`, then push `main`.
5. Open the repository on GitHub and make certain the mascot, masthead and inspector image render in the README.

[Working Copy's own guide](https://workingcopy.app/manual.html) documents Files imports, GitHub remotes and pushing. Its push feature requires the paid unlock. If you use another serious mobile Git client, the operation is the same: import the extracted repository, add the remote and push `main`.

The ordinary `mirrorling.zip` is the clean source edition. When its extracted directory is copied into Working Copy without a `.git` directory, Working Copy will initialise a new repository and stage the files; commit them with `Initial release candidate: Mirrorling v1.2.0-rc.1`, add the remote and push.

## Any other phone with Git

Unzip `mirrorling-ready-to-push.zip`, import the resulting directory into a mobile Git client, add the empty GitHub repository as `origin` and push `main`. If the client exposes a terminal, the entire ceremony is three commands:

```sh
cd /path/to/mirrorling
git remote add origin https://github.com/YOUR-ACCOUNT/mirrorling.git
git push -u origin main
```

`mirrorling.bundle` is the smaller expert fallback. A mobile terminal with ordinary Git can turn it back into the same committed repository:

```sh
git clone /path/to/mirrorling.bundle mirrorling
git -C mirrorling remote set-url origin https://github.com/YOUR-ACCOUNT/mirrorling.git
git -C mirrorling push -u origin main
```

Do not upload either ZIP as a single file through GitHub's web form. GitHub will commit the archive intact, like a suitcase nobody can open from the hallway. It does not unpack archives into repository trees.

## Dress the repository after the push

1. In the repository's **About** panel, paste the description and topics above.
2. In **Settings → General → Social preview**, upload `docs/brand/mirrorling-social-preview.png`. It is already the recommended 1280 × 640 and remains below GitHub's 1 MB limit.
3. Create a release from tag `v1.2.0-rc.1`, use the title above and paste the notes below.
4. Attach the clean `mirrorling.zip` source archive to the release if you want a stable hand-delivered artefact in addition to GitHub's generated archives.
5. Import the repository into Netlify when ready. `netlify.toml` owns the build and routing; set `BENCH_UPSTREAM_ORIGIN` for the authorised production origin, or commit the intended origin in `bench.config.json`.

## Ready-to-paste release notes

> Mirrorling borrows a living production site through an independent staging origin, permits precise element overrides, independent JavaScript and production-script replacement, then hands the same browser tab cleanly back to production using client-side state alone.
>
> This first branded release candidate includes the local selector inspector and scaffolding workflow, JSON configuration, Netlify Functions support, staging authentication, explicit handover contracts, original project artwork and a strict release gate covering 24 unit and integration tests, the real Netlify bundle, dependency audit and two Playwright browser journeys.
>
> No scenario means the baseline mirror. No YAML means no YAML. Both are policy, not mood.

## Final prohibitions

- Do not commit `.env`, credentials, customer data or private certificates.
- Do not publish the package to npm; `private: true` is deliberate.
- Do not claim WebSocket or authoring parity on Netlify. Those remain local Node-runtime features.
- Do not soften the README into corporate porridge. There is enough of that already.
