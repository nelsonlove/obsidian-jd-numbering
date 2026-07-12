# Johnny Decimal Dashboard — Obsidian Plugin

Live JD system awareness inside the Obsidian vault. Inbox dashboard, drift detection, vault auditing, frontmatter normalization, and quick ID navigation.

Companion plugin to the [jd-tools](https://github.com/nelsonlove/jd-tools) CLI suite. Reads the same `jd-index.yaml` and `jd.yaml` that jd-cli uses, but has no runtime dependency on it — either tool can be installed and used independently. The two coordinate purely through the shared YAML files.

## Features

### Inbox Dashboard
Sidebar panel showing all `.01 Unsorted/Inbox` directories with item counts, grouped by area, busiest-first. Click a row to reveal the folder in the file explorer. Live-updates on vault changes.

### Drift Panel
Sidebar panel showing notes with frontmatter/location issues, grouped by type:

- **Missing frontmatter** — JD ID in filename but no `jd-id` field. One-click fix button.
- **ID mismatch** — filename and frontmatter disagree on the ID.
- **Wrong folder** — note is in the wrong category directory.
- **Missing stubs** — JDex entries without a corresponding note. One-click create button.

Status bar shows "JD: N drifted" — click to open the panel.

Notes can opt out of any drift check via the [`jd-ignore`](#opting-out-with-jd-ignore) frontmatter field; ignores cascade from folder cover notes.

### Vault Audit
Comprehensive health check with 10 validation rules across 3 severity levels:

| Severity | Checks |
|----------|--------|
| Error | Missing required fields, invalid date formats, invalid categories, duplicate IDs |
| Warning | Orphaned files, title mismatches, missing stubs |
| Info | Broken wikilinks, empty notes, stale surveyed dates |

Generates a markdown report at `00.00+REPORT JD vault audit.md`. Optional auto-run on startup. Honors `jd-ignore`.

### Frontmatter Normalizer
Auto-corrects frontmatter on save. Each behavior is independently toggleable in settings; the keys it operates on are configurable.

| Behavior | Default | Setting |
|----------|---------|---------|
| Master switch | on | Enable normalizer |
| Quote ID values (so YAML doesn't read `06.12` as a float) | on | Quote ID values |
| Infer type when missing (from ID pattern) | on | Infer type when missing |
| Sort frontmatter keys into canonical order | on | Sort frontmatter keys |
| Strip `# XX.YY Title` heading prefix to `# Title` | on | Strip ID from H1 heading |

The type can be expressed as a frontmatter key (default) or as a tag — see [Type representation](#type-representation).

### Quick ID Navigation
Command palette: **JD: Go to ID** — fuzzy search by JD ID number or title.

### Drift Report
Generates `00.00+REPORT JD drift report.md` with drift details, inbox summary, and missing stubs.

### +README Migration
One-shot migration command for vaults coming from the legacy `+README` cover-note scheme — see [Cover notes](#cover-notes).

### Render category JDex contents
Walks every `XX.00 JDex for category XX.md` file and regenerates a bullet list of `[[ID Title]]` wikilinks for every entry in that category — both JDex YAML entries and 5-digit filesystem-only items (e.g. `92001 Substrate`). The list is wrapped in HTML sentinel comments so prose above and below is preserved across runs:

```
<!-- jd:render-start -->
- [[01.01 Inbox for category 01]]
- [[01.06 Knowledge base for category 01]]
...
<!-- jd:render-end -->
```

Also flags drifted wikilinks in the existing content — references with bad IDs (e.g. `[[76.09 Archive for category 77]]` when the entry is actually `77.09`) are logged to the console.

### Promote note to folder
Converts the active ID note (`06.13 Bar.md`) into a same-named folder with the note moved inside as the cover note (`06.13 Bar/06.13 Bar.md`). Useful when a leaf note grows enough to need siblings.

## Commands

| Command | Description |
|---------|-------------|
| JD: Open inbox dashboard | Open the inbox sidebar panel |
| JD: Open drift panel | Open the drift detection sidebar |
| JD: Go to ID | Fuzzy search by ID or title |
| JD: Run vault audit | Generate comprehensive health report |
| JD: Generate drift report | Write drift/inbox markdown report |
| JD: Check for drift | Quick drift count (status bar + console) |
| JD: Migrate +README files to folder-named cover notes | One-time migration from the legacy scheme |
| JD: Render category JDex contents | Regenerate `XX.00 JDex` files from JDex YAML + filesystem |
| JD: Promote note to folder | Convert active ID note to same-named folder with note moved inside |

## Settings

### Paths

| Setting | Default | Description |
|---------|---------|-------------|
| JD root | `~/Documents` | Filesystem root of the JD tree |
| JDex path | `~/.local/share/jd/jd-index.yaml` | Path to the JDex index file |

### Dashboard / Audit

| Setting | Default | Description |
|---------|---------|-------------|
| Show empty inboxes | off | Show inbox folders with 0 items |
| Stale surveyed threshold | 90 days | Days before surveyed date is flagged |
| Audit on startup | off | Run vault audit when Obsidian opens |

### Frontmatter keys

The keys can be renamed; all checks, generators, and the normalizer use the configured names. Changing these does **not** migrate existing notes.

| Setting | Default | Notes |
|---------|---------|-------|
| Title key | `jd-title` | |
| ID key | `jd-id` | |
| Type key | `jd-type` | Ignored when "Type as tag" is on |
| Ignore key | `jd-ignore` | See [Opting out](#opting-out-with-jd-ignore) |

### Frontmatter normalizer

All five toggles default on, preserving prior behavior.

| Setting | Default | Description |
|---------|---------|-------------|
| Enable normalizer | on | Master switch |
| Quote ID values | on | Wrap unquoted IDs in single quotes |
| Infer type when missing | on | Add type from ID pattern |
| Sort frontmatter keys | on | Reorder keys into canonical order |
| Strip ID from H1 heading | on | Rewrite `# XX.YY Foo` as `# Foo` |

### Type representation

| Setting | Default | Description |
|---------|---------|-------------|
| Type as tag | off | Express type as a tag instead of a frontmatter key |
| Type tag prefix | `jd/` | Prefix prepended to the type value (e.g. `jd/inbox`) |
| Type tag overrides | (empty) | One per line as `type: tag`. Overrides the prefix-based tag for that type. |
| Persist generic 'id' type | on | Off → don't write a type when the inferred value is the generic `id` |

When **Type as tag** is on, the normalizer (and report generators) emit:

```yaml
tags:
    - jd/inbox
```

instead of `jd-type: inbox`. Per-type overrides let you replace the prefix entirely; e.g. mapping `knowledge-base: kb` produces the tag `kb` instead of `jd/knowledge-base`.

## Cover notes

A folder representing a JD ID (e.g. `06.12 Foo/`) gets a cover note inside it whose **basename matches the folder name**: `06.12 Foo/06.12 Foo.md`. The cover note's `jd-id` is the bare ID — no `+README` suffix.

```yaml
---
jd-id: '06.12'
jd-title: Foo
jd-type: id
created: 2026-04-29
---

# Foo

## Contents
```

This replaces the older convention where the cover note was `XX.YY+README.md` with an `aliases:` block. Categories are unchanged: they still use a `XX.00 JDex for category XX.md` index file rather than a cover note. Use **JD: Migrate +README files to folder-named cover notes** to convert legacy vaults; the command updates wikilinks via Obsidian's `fileManager.renameFile`.

## Opting out with `jd-ignore`

Any note can opt out of drift/audit checks via its `jd-ignore` frontmatter:

```yaml
jd-ignore: true                       # silence all checks
jd-ignore: [title-mismatch]           # silence specific checks
jd-ignore: title-mismatch, empty-note # comma-separated form
```

**Cascade:** the ignore list of a folder's cover note also applies to every note in that folder (and recursively). Set `jd-ignore: true` on `92001 Substrate/92001 Substrate.md` to silence the whole subtree.

Recognized check names match what the audit/drift reports emit: `missing-frontmatter`, `id-mismatch`, `wrong-folder`, `title-mismatch`, `required-fields`, `date-format`, `valid-category`, `duplicate-id`, `orphaned-file`, `broken-wikilink`, `empty-note`, `stale-surveyed`, `missing-stub`.

## Frontmatter schema

```yaml
---
jd-title: Restraining order
jd-id: '26.11'
jd-type: id
jd-location: filesystem
created: 2026-03-31
modified: 2026-04-23
surveyed: 2026-03-31
---
```

### `jd-type` values

| Type | Source | Description |
|------|--------|-------------|
| `id` | leaf IDs | Regular JD ID note |
| `index` | `.00` | JDex/meta note |
| `inbox` | `.01` | Inbox/unsorted |
| `tasks` | `.02` | Task & project management |
| `templates` | `.03` | Templates |
| `links` | `.04` | Link collections |
| `policies` | `.05` | Conventions & policies |
| `knowledge-base` | `.06` | Knowledge base |
| `someday` | `.08` | Someday/maybe |
| `archive` | `.09` | Archive |
| `report` | `+REPORT` | Generated reports |
| `audit` | `+AUDIT` | Audit documents |
| `meta` | other `+` sub-IDs | `+CLAUDE`, `+INDEX`, etc. |

## Development

```sh
cd ~/repos/jd-obsidian
npm install
npm run dev     # watch mode — rebuilds on change
npm run build   # production build
```

The plugin is symlinked into the vault at `.obsidian/plugins/jd-dashboard/` for development. After building, reload Obsidian (Cmd+R) to pick up changes.

## Architecture

```
src/
├── main.ts                  # Plugin entry point — lifecycle, commands, events
├── settings.ts              # Settings tab and defaults
├── keys.ts                  # Key-name and tag/ignore helpers driven by settings
├── ignores.ts               # Cascading jd-ignore resolution
├── jdex.ts                  # JDex YAML parser and lookup helpers
├── scanner.ts               # Inbox counter, drift detector, stub finder
├── normalizer.ts            # Frontmatter auto-correction on save (5 toggles)
├── validator.ts             # Validation checks, report engine
├── commands/
│   ├── go-to-id.ts          # SuggestModal for fuzzy ID search
│   ├── drift-report.ts      # Markdown drift report generator
│   ├── audit-report.ts      # Markdown audit report generator
│   ├── migrate-readme.ts    # Legacy +README → folder-named migration
│   ├── render-jdex.ts       # Regenerate XX.00 JDex contents
│   └── promote-to-folder.ts # Convert leaf note to ID directory + cover note
└── views/
    ├── inbox-dashboard.ts   # Sidebar: inbox counts by area
    └── drift-panel.ts       # Sidebar: drifted notes with fix buttons
```
