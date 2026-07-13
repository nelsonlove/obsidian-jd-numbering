# JD plugins (monorepo)

Two focused [Johnny Decimal](https://johnnydecimal.com/) plugins for Obsidian,
developed together here. They share JD conventions but are independent Obsidian
plugins with their own manifest IDs.

| Package | Plugin ID | BRAT repo | What it does |
| --- | --- | --- | --- |
| [`packages/numbering`](packages/numbering) | `jd-numbering` | [`nelsonlove/jd-numbering-brat`](https://github.com/nelsonlove/jd-numbering-brat) | Assign the next ID, refile to match `jd-id`, lint numbering, refresh a JDex index. |
| [`packages/dashboard`](packages/dashboard) | `jd-dashboard` | [`nelsonlove/jd-dashboard-brat`](https://github.com/nelsonlove/jd-dashboard-brat) | Inbox dashboard, drift detection, quick ID navigation, template-driven note creation. |

The dashboard was previously the standalone `jd-obsidian` repo; it was folded in
here (with full commit history) and that repo archived.

## Working on a package

Each package is self-contained:

```bash
cd packages/numbering   # or packages/dashboard
npm ci
npm run build           # esbuild -> main.js
```

`packages/numbering` also has a headless test suite: `node test/run.mjs`.

## Installing via BRAT

Because [BRAT](https://github.com/TfTHacker/obsidian42-brat) reads a plugin's
`manifest.json` / `main.js` from a repo **root**, and this repo has two plugins
under `packages/`, each plugin is mirrored to its own thin **`-brat` repo** that
holds only the built files at its root. Install those, not this repo:

- JD Numbering → **Add beta plugin** → `nelsonlove/jd-numbering-brat`
- JD Dashboard → **Add beta plugin** → `nelsonlove/jd-dashboard-brat`

The `-brat` repos are generated — never edit them by hand. They're refreshed
automatically on release (see below).

## Releases

Push a per-package tag; CI builds that package and pushes the built files to its
`-brat` repo:

| Tag pattern | Builds | Publishes to |
| --- | --- | --- |
| `numbering-v1.2.3` | `packages/numbering` | `jd-numbering-brat` |
| `dashboard-v1.2.3` | `packages/dashboard` | `jd-dashboard-brat` |

Full details — the tag rule, the shim/BRAT mechanism, and the manual fallback — are in **[RELEASING.md](RELEASING.md)**.

## License

MIT — see [LICENSE](LICENSE).
