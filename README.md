# JD Numbering

A small, focused [Johnny Decimal](https://johnnydecimal.com/) helper for Obsidian. It does four things and nothing else:

| Command | What it does |
| --- | --- |
| **JD: Assign next number** | Finds the next free ID for a category (index-first, no collisions), sets the `jd-id` frontmatter, and refiles the active note to `<jd-id> <title>.md`. Shows a before → after confirmation first. |
| **JD: Refile active note to match its jd-id** | Renames + moves the active note so its filename and folder match its `jd-id`. Can leave a `system/redirect` stub at the old path. |
| **JD: Lint vault** | Read-only scan → a report note. Flags duplicate IDs, malformed IDs, filename ↔ frontmatter ↔ folder mismatches, missing IDs, and naming-hygiene issues. |
| **JD: Refresh index** | Regenerates a master JDex index note (area → category → ID). |

## Conventions it assumes

- **Filenames** are `<jd-id> <title>.md` (e.g. `06.11 Tailscale.md`).
- **Folders** are `XX-YY Area` / `XX Category`.
- **`jd-id`** lives in frontmatter as a **quoted string** (`jd-id: "06.11"`) so leading zeros survive.
- **Standard zeros** `.00`–`.09` are reserved; content IDs start at `.10`.
- Frontmatter is treated as canonical (source of truth), not the filesystem.

### Expansion-aware

Valid ID shapes include more than `XX.YY`:

- **Expanded areas** — a whole band using 5-digit IDs (e.g. `90-99` → `92021`).
- **Expanded categories** — a single category using 5-digit flat IDs (e.g. `27` → `27001`).
- **Fractal IDs** inside an expanded area (e.g. `92021.10`).

These are configured in settings (defaults: expanded area `90-99`, expanded category `27`) and are **not** flagged as errors by the linter. Malformed shapes like `26 2.18` are.

## Automatic linting

Optionally surface JD issues for the **active note** as you work — in the spirit of Obsidian Linter's *Lint on save* / *Lint on file change*, but **read-only**: it never moves or renames files.

- **Lint on save** — check the active note when it's saved/modified.
- **Lint on file change** — check a note when you open or switch to it.
- **Show status-bar indicator** — show the active note's status in the status bar (on by default). Turn it off to run notice-only.
- **Show notice on issues** — also pop a notice listing the note's issues (otherwise it's status-bar only).

A status-bar item shows the active note's state — `JD ✓` when clean, `JD ⚠ N` (details on hover) when not. Click it to run a full **Lint vault**. Automatic linting runs the note-local checks only; `duplicate-id` needs the whole vault, so it stays with the manual *Lint vault* command.

## Settings

- **Expanded areas** / **Expanded categories** — comma-separated.
- **Index note path** — where *Refresh index* writes (default `JD index.md`).
- **Lint report path** — where *Lint vault* writes (default `JD lint report.md`).
- **Leave redirect stub on refile** — off by default.
- **Lint on save** / **Lint on file change** — automatic linting triggers, off by default.
- **Show status-bar indicator** (on by default) / **Show notice on issues** (off by default).

## Safety

Destructive commands (*Assign*, *Refile*) act on the **active note only** and always show a confirmation modal with the exact before → after path. *Lint* and *Refresh index* are read-mostly (index writes a single generated note).

## Install (BRAT)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) community plugin.
2. BRAT → **Add beta plugin** → `nelsonlove/jd-numbering`.
3. Enable **JD Numbering** in Community plugins.

## Develop

```bash
npm install
npm run dev     # watch build
npm run build   # type-check + production bundle
```

Releases are cut by pushing a tag (`x.y.z`) — see `.github/workflows/release.yml`.

## License

MIT
