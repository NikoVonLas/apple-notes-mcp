# Local build: 2.8.2-local.4

The running MCP confirmed local.4's capabilities on 2026-09-06; both configured
Shortcuts bridges are installed. This build adds 15 tools for folder
rename, native object/table inspection, file insertion, and gated native
operations through a separately signed Background Operations shortcut.

Live checks on 2026-09-05 verified folder rename with unchanged folder/note IDs,
file insertion with exact fetched bytes, and native table decoding with Cyrillic
and emoji. Background Operations v4 is installed. Tag removal and replacement
passed live preservation checks; replacement adds through the verified Native
Tags bridge before removing through v4. Append, checklist creation, table
creation, link insertion and pinning still require diagnosis of interactive
parameter prompts and remain disabled. The original test note was used only
for these isolated checks.
The final suite passed 666 tests; the built MCP passed all 7 output-schema
contract tests. Four bridge-generator tests, TypeScript and ESLint checks passed. File insertion deduplicates
repeated references to the same native attachment ID before verifying bytes.
Native table/attachment deletion failed in both supported routes on this macOS
and stays unavailable. See `get-capabilities` and `shortcuts/README.md`.

Rich revisions now include referenced attachment/table metadata, so table-only
changes invalidate stale tokens. Native operations verify original links, text,
style runs, checklist states and native objects without replacing the body.
Read-only table decoding returns native row/column IDs and discloses incomplete
cell data. The committed table test fixture comes only from our temporary test
note, not pre-existing user content.

## Existing local.2 changes

Based on upstream v2.8.2, commit `08a9517677a3fd8efc47e98c5cb07c91a886f9f8`.

Apple Notes preserves hyperlinks when HTML is written through AppleScript, but
can omit their URLs from the HTML returned by `body`. Reading that body and
writing it back silently destroys links. This build recovers URL attributes
from the requested note's gzip/protobuf data in `NoteStore.sqlite`, opened
strictly read-only. Text writes go through Notes.app's AppleScript API;
native tag additions use Notes' Shortcuts actions.

## Behavior

- `get-note-content` restores link URLs in HTML and returns `links`,
  `nativeTags`, `richContentComplete`, and `writable`.
- HTML and rich text must match before positional links are restored. Repeated
  labels, Cyrillic, UTF-16 emoji, formatting spans, and Notes' semicolonless
  HTML entities are handled without assigning a URL to the wrong occurrence.
- `get-note-markdown` and Markdown resources preserve restored links.
- Revisions include native rich-text data, so URL-only changes invalidate the
  old token. Updates recheck the rich revision immediately before the existing
  guarded AppleScript body write. This is optimistic concurrency, not a
  transaction spanning iCloud and Notes.app.
- Update and append verify link destinations as well as visible text. Updates
  preserve existing links by default; `allowLinkChanges=true` explicitly permits
  changing or removing them. Append uses enriched HTML rather than lossy HTML.
- If metadata cannot be read/matched, reads disclose the limitation and full
  body writes stop. This needs the existing Full Disk Access permission and a
  compatible Notes database schema.

## Native tags and other rich objects

Inline `#hashtags` are searchable text, not proof of native tag registration.
`nativeTags` reports only tag objects referenced by the note's current rich-text
runs; stale/deleted attachment rows are ignored.

AppleScript has no native tag creation API. This build adds `native-tags-status`
and `add-native-tags`, using Notes' `CreateTagLinkAction` and
`AddTagsToNotesLinkAction` through a separately installed Shortcuts bridge.
See `shortcuts/README.md` for setup, selection checks and live validation status.
It never treats plain hashtags as proof of native tags or writes to the database.
If native metadata is readable but the HTML cannot be matched, reads keep the
verified `links`, `nativeTags` and rich revision while marking content incomplete.

Full-body writes to notes containing native tags, inline objects or checklists
are blocked, because AppleScript's body export cannot preserve those objects.
Existing attachment guards remain. Native tagging is additive and does not
unlock full-body rewriting; native append/edit remains a separate capability.

## Validation

Unit tests cover rich-text decoding, actual link ranges, duplicate labels,
Unicode, HTML entities, invalid schemes, incomplete metadata, native objects,
revision changes, and link-loss prevention. Live stdio MCP checks create two
temporary notes, read/update/append links, verify Markdown, reject stale writes
and accidental link removal, permit an explicit URL change, and remove only
the two test notes afterward.

The five Shamaal project notes were also read through the patched MCP; their
links were recovered without Computer Use.

Native tag validation on 2026-09-05 covered 13 notes in the Shamaal and notes
organization project folders. All existing body hashtags were confirmed in
`nativeTags`, and link destinations and labels were preserved. The full suite
passed 609 tests. Selection phrases must distinguish the target from other
projects' similarly titled notes; native search can match differently from
AppleScript, so uncertain outcomes require a fresh read before any retry.

## Build and restore

Use the repository's pinned Corepack pnpm version:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm run build
```

Codex uses the separately installed `2.8.2-local.4` bundle and the verified
native-tag Shortcut UUID. The previous local.1, local.2 and local.3 builds are retained.
The original `2.8.2` bundle remains installed, allowing rollback by changing the
MCP command back to that version. The source checkout is on
`fix/rich-note-links`; no changes have been published upstream.
