# Monorepo split — jd-numbering + jd-dashboard become standalone repos (2026-07-14)

## Goal

Split the two-plugin monorepo into two standalone Obsidian-plugin repos and
retire the `-brat` shim repos entirely.

## Why the shims existed, and why they can now go

[BRAT](https://github.com/TfTHacker/obsidian42-brat) installs a plugin by
reading `manifest.json` from a repo **root**, then downloading the built files
from a **GitHub Release** on that same repo. A two-plugin monorepo has neither a
root manifest nor a single tag namespace, so each plugin was mirrored to a thin
`-brat` repo (fed by per-package tags → deploy-key cross-repo push → the shim's
own release workflow).

Once each plugin lives in its **own** repo with files at the root and its own
Releases, BRAT installs from the real repo directly. The shims, their deploy
keys, and the cross-repo publish machinery become dead weight.

## End state

| Plugin id | Repo (BRAT installs from) | Layout |
| --- | --- | --- |
| `jd-numbering` | `nelsonlove/obsidian-jd-numbering` (this repo, flattened) | files at root |
| `jd-dashboard` | `nelsonlove/obsidian-jd-dashboard` (new) | files at root |

Retired: `jd-numbering-brat`, `jd-dashboard-brat`, `obsidian-jd` (archived);
`NUMBERING_SHIM_DEPLOY_KEY` / `DASHBOARD_SHIM_DEPLOY_KEY` Actions secrets
(deleted); the shim/deploy-key parts of `release.yml` + `RELEASING.md`.

## History preservation

- **Numbering:** flattened *in place*. `git mv packages/numbering/* .` → root,
  delete `packages/` and the stale root `main.js`. The repo keeps its entire
  commit history; git follows the renames. One restructure commit → PR → merge.
- **Dashboard:** the `obsidian-jd` repo already holds the dashboard's full
  59-commit history, already at root layout, with code byte-identical to the
  current `packages/dashboard` (only the README banner differs). The new
  `obsidian-jd-dashboard` repo is **seeded from `obsidian-jd`'s history**, plus
  one commit to swap in the current README and add standalone workflows. A
  `git subtree split -P packages/dashboard` was rejected: it captures only the 2
  post-rename commits.

## Self-publishing workflows (both repos)

- `build.yml` — on PR/push to main: `npm ci`, `tsc --noEmit`, build, assert
  `main.js`. Numbering also runs `node test/run.mjs`. No matrix.
- `release.yml` — on a bare `x.y.z` tag (Obsidian convention, no `v`): build,
  assert tag == `manifest.version`, create a GitHub **Release on this repo** with
  `main.js` / `manifest.json` / `styles.css` (+ `versions.json` for numbering)
  attached. `contents: write`, `GITHUB_TOKEN` only — no deploy key.

## Cutover order

1. Merge the numbering flatten PR → tag `0.3.0` → first self-Release.
2. Create `obsidian-jd-dashboard`, push seeded history → tag `0.2.0` →
   first self-Release.
3. Re-point BRAT in the vault to the two real repos; drop the `-brat` betas.
4. Archive `jd-numbering-brat`, `jd-dashboard-brat`, `obsidian-jd`; delete the
   two `*_SHIM_DEPLOY_KEY` secrets.
5. Update the `jd-numbering` memory note + `MEMORY.md` pointers.
