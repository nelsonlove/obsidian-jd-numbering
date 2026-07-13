# Releasing

This repo is a monorepo holding two independent Obsidian plugins:

| Package | Plugin id | BRAT repo |
| --- | --- | --- |
| `packages/numbering` | `jd-numbering` | [`nelsonlove/jd-numbering-brat`](https://github.com/nelsonlove/jd-numbering-brat) |
| `packages/dashboard` | `jd-dashboard` | [`nelsonlove/jd-dashboard-brat`](https://github.com/nelsonlove/jd-dashboard-brat) |

## Why the `-brat` repos exist

[BRAT](https://github.com/TfTHacker/obsidian42-brat) assumes **one plugin per repo**:
it reads `manifest.json` from the repo **root** (`raw.githubusercontent.com/<repo>/HEAD/manifest.json`)
to learn the version, then downloads `main.js` / `manifest.json` / `styles.css`
from that repo's **GitHub Release** tagged with that version
(`api.github.com/repos/<repo>/releases/tags/<version>`).

A two-plugin monorepo can't satisfy that (no single root manifest, and one tag
namespace for two plugins). So each plugin is mirrored to a thin **`-brat`**
repo that BRAT *can* install from. Two conditions must hold in a `-brat` repo:

1. Its **root `manifest.json`** is the current version (for BRAT's version check).
2. It has a **GitHub Release whose tag equals that version** (no `v` prefix),
   with `main.js` / `manifest.json` / `styles.css` attached as assets.

> A `-brat` repo with the files committed at root but **no Release** produces
> BRAT's `Error: No releases found in this repository.` — the release is what
> BRAT actually installs from.

The `-brat` repos are **generated — never edit them by hand.**

## Cutting a release

1. Bump the version in the package's `manifest.json` (and add a line to its
   `versions.json` if `minAppVersion` changed). Commit to `main` via the normal
   PR flow.
2. Tag the merge commit with a **per-package, `v`-prefixed** tag whose version
   **exactly matches** that package's `manifest.json`:

   ```bash
   git tag numbering-v0.3.1     # or  dashboard-v0.2.1
   git push origin numbering-v0.3.1
   ```

That's it. Everything below is automatic.

### What the tag triggers

```
push tag numbering-v0.3.1
        │
        ▼
monorepo .github/workflows/release.yml
  • resolves package from the tag prefix (numbering-* / dashboard-*)
  • builds packages/numbering
  • FAILS if the tag version != packages/numbering/manifest.json version
  • pushes main.js/manifest.json/styles.css/versions.json into
    jd-numbering-brat over that shim's SSH deploy key
        │
        ▼  (the deploy-key push triggers the shim's own workflow)
jd-numbering-brat .github/workflows/release.yml
  • reads the version from the refreshed root manifest.json
  • creates (or refreshes) the GitHub Release tagged <version>
    with the built files as assets — using the shim's own GITHUB_TOKEN
        │
        ▼
BRAT installs jd-numbering-brat from releases/tags/<version>
```

### Rules & gotchas

- **Tag prefix is required.** A bare `0.3.1` (or `v0.3.1`) matches neither
  package and the workflow **fails loudly** in "Resolve target" rather than
  silently doing nothing. Use `numbering-v*` / `dashboard-v*`.
- **Tag version must equal the manifest version**, or the build step fails on
  purpose (prevents a mislabeled release).
- **The monorepo does not cut its own GitHub Releases.** Releases live only in
  the `-brat` repos. (Historic bare-semver releases on this repo are inert.)

## Manual fallback

If a `-brat` release is ever missing (e.g. the deploy-key push didn't trigger
the shim workflow), publish it directly — the shim workflow also accepts a
manual run and will create/refresh the Release for whatever version its root
`manifest.json` currently holds:

```bash
gh workflow run release.yml -R nelsonlove/jd-numbering-brat    # or jd-dashboard-brat
```

This is also how the initial `0.3.0` / `0.2.0` releases were seeded.

## Infrastructure (one-time, already provisioned)

- Each `-brat` repo has a **read-write SSH deploy key** titled `monorepo-publisher`.
- The matching **private keys** are stored as Actions secrets on this repo:
  `NUMBERING_SHIM_DEPLOY_KEY` and `DASHBOARD_SHIM_DEPLOY_KEY`.
- The monorepo release workflow uses only `contents: read`; the cross-repo push
  is authenticated by the deploy key, and the Release is created by the shim's
  own `GITHUB_TOKEN` (`contents: write`). No personal access token is involved.
