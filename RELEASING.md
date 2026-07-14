# Releasing

This repo is a single Obsidian plugin (`jd-numbering`). [BRAT](https://github.com/TfTHacker/obsidian42-brat)
installs it directly: it reads the root `manifest.json` for the version, then
downloads `main.js` / `manifest.json` / `styles.css` from the **GitHub Release**
tagged with that version.

## Cutting a release

1. Bump the version in `manifest.json` (and add a line to `versions.json` if
   `minAppVersion` changed). Commit to `main` via the normal PR flow.
2. Tag the merge commit with a **bare** `X.Y.Z` tag (Obsidian convention — no
   `v` prefix) whose version **exactly matches** `manifest.json`:

   ```bash
   git tag 0.3.1
   git push origin 0.3.1
   ```

That's it. `.github/workflows/release.yml` then:

- builds the plugin,
- **fails** if the tag version != `manifest.json` version (prevents a
  mislabeled release),
- creates (or refreshes) a GitHub Release tagged `X.Y.Z` with
  `main.js` / `manifest.json` / `styles.css` / `versions.json` attached.

BRAT installs from that Release. No deploy keys, no cross-repo push — the
workflow uses only this repo's `GITHUB_TOKEN` with `contents: write`.

## Rules & gotchas

- **Tag must be bare `X.Y.Z`** (no `v`), matching the manifest version. The
  trigger is broad, so a mistyped tag (e.g. `v0.3.1`) still starts the run and
  **fails loudly** in "Resolve version" rather than silently doing nothing.
- The published version always comes from `manifest.json`, never from operator
  input, so a Release can't be mislabeled relative to the code it ships.
- A tag without a matching Release produces BRAT's
  `Error: No releases found in this repository.` — the Release is what BRAT
  actually installs from, so let the workflow finish.

## Manual fallback

Re-publish the current manifest version at any time (regenerates the Release,
anchored to the branch's HEAD):

```bash
gh workflow run release.yml
```

## History

This repo was previously a two-plugin monorepo (`packages/numbering` +
`packages/dashboard`) that published through thin `-brat` shim repos. It was
flattened to a single plugin on 2026-07-14 and the dashboard moved to
[`nelsonlove/obsidian-jd-dashboard`](https://github.com/nelsonlove/obsidian-jd-dashboard).
See [docs/2026-07-14-monorepo-split.md](docs/2026-07-14-monorepo-split.md).
