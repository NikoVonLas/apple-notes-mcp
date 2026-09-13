# Notes background bridges

For packaged installations, run `apple-notes-mcp setup`. It checks both bridge
UUIDs and opens only missing signed workflows. Confirm **Add Shortcut** in each
macOS window, then run `apple-notes-mcp setup --check` or the MCP `doctor` tool.
Connecting an MCP client alone never opens setup UI.

## Append diagnosis — completed 2026-09-13

The v4 retry reached `WFAppendToNoteAction` and asked for `text`; the user
confirmed a text-input dialog. Modern `text` and `entity` parameters still
requested a note and text. A temporary probe isolated the serialization issue.

Read-only comparison with the installed workflow confirms both parameter
references still point to existing producer UUIDs. Import added an
`AppIntentDescriptor`, localized note output names and an output action; it did
not remove the supplied text or note references. A known-good append action
authored by the native editor was used to compare execution serialization
before generating the v5 candidate.

At the user's request, the append action was recreated with the native editor.
Its serialization uses `WFNote` for the note and `WFInput` as a
`WFTextTokenString` containing the text producer reference, plus the Notes
`AppIntentDescriptor`. V4 supplied a bare attachment token as `WFInput`;
Probe 1's initial modern `text`/`entity` parameters also failed. The generators
now reproduce the native editor's format, and the generator test guards it.

The edited probe appended the requested plaintext without parameter dialogs.
Notes regenerated only its private 16-byte paragraph UUID on the first native
edit of imported HTML. The preservation signature now ignores that nonvisual
identifier while retaining alignment, indentation, block quote, checklist and
unknown paragraph fields. The rich revision still includes the original bytes.
HTML-link verification now uses the same character-to-URL signature as guarded
HTML writes, so Notes' layout whitespace does not create a false failure.
Visible appended text is checked from Notes HTML because a newly recognized
native hashtag may occupy an object range in the internal rich-text stream.

The production v5 candidate passed exact-ID live checks for plaintext, semantic
HTML, Markdown, a native checklist item, a native table, pin and unpin, and an
internal Notes link. Each operation preserved the rich note's existing text,
formatting, links, checklist IDs/state and native objects. Transport output is
never treated as proof; every mutation is accepted only after Notes readback.

Computer Use was used only for the user-authorized one-time editor repair;
the append tests ran through the background integration. No native objects
were stripped and no Notes or Shortcuts database writes were used.

## Background Operations v5

Installed and tested on 2026-09-13. The exact installed UUID is
`68529563-79FA-4075-A96D-8C84FB1744E8`. The previous versions remain installed;
select the UUID, not a duplicate display name.

Version 2.9.0 enables `append-native`, `create-checklist-item`, `create-table`,
`set-note-pinned` and `insert-note-link`. It retains v4's verified native tag
removal. `replace-native-tag` still uses the separate Native Tags bridge for
addition, verifies the new tag, then removes the old one through v5.

The signed `Apple Notes MCP - Background Operations v5.shortcut` contains a
fixed allowlist, exact title/literal scope checks after unique native search,
and a read-only `probe` branch. It has no UI automation, shell, network actions
or database writes. Native create actions explicitly set `OpenWhenRun=false`.
The MCP rechecks revisions and verifies text, links, native object contents and
checklist IDs/state. A timeout never triggers an automatic write retry.

Versions 1–4 exposed serialization issues: untyped dictionary values in string
conditions, text token parameter bindings, and the native append alias being
mapped at runtime to `WFAppendToNoteAction`. V5 uses the native editor's
text-token `WFInput`, typed comparisons, the correct `WFHTML` key and fixed pin
enum values. Four generator tests cover these execution boundaries. Signing
checks importability; it does not prove successful Notes behavior.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/test-native-operations-shortcut.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/build-native-operations-shortcut.py
shortcuts sign --mode anyone \
  --input "$PWD/shortcuts/Apple Notes MCP - Background Operations v5.unsigned.shortcut" \
  --output "/private/tmp/Apple Notes MCP - Background Operations v5.shortcut"
```

The CLI has no supported import command; installation requires Add Shortcut
once per imported workflow. Never set `APPLE_NOTES_MCP_ALLOW_UNVERIFIED` in the
normal host configuration; it is reserved for isolated acceptance tests.

Native checklist checking/deletion, table/attachment deletion, attachment size,
mentions and direct Markdown append were rejected by this Mac's signer.
AppleScript attachment/table deletion also returned `AppleEvent handler failed`.
No full-body rewrite or UI fallback replaces these operations.

## Native tags bridge (existing verified installation)

Status: live Notes validation passed on 2026-09-05: native Cyrillic tags, preserved
text/links, idempotence, stale revision refusal and ambiguous selection refusal.
Both temporary notes were removed. The full suite passes 609 tests.
Signing verifies the file format, not Notes behavior.

The MCP tools `native-tags-status` and `add-native-tags` invoke the installed
`Apple Notes MCP - Native Tags` Shortcut through `/usr/bin/shortcuts run`.
The optional `APPLE_NOTES_MCP_TAGS_SHORTCUT` setting selects its name or UUID.
The bridge resolves one exact installed UUID before running; duplicate names are
refused. The JSON input uses a private temporary file, removed after execution.
CLI output is not proof of success; the exact note is read back for verification.

Generate and sign (no note contents or credentials are embedded in the file):

```sh
python3 scripts/build-native-tags-shortcut.py
shortcuts sign --mode anyone \
  --input "$PWD/shortcuts/Apple Notes MCP - Native Tags.unsigned.shortcut" \
  --output "$PWD/shortcuts/Apple Notes MCP - Native Tags.shortcut"
```

Open the signed file and confirm Add Shortcut once. macOS may also ask to allow
Notes access on the first run. Subsequent runs use the CLI without UI automation.
The CLI supports running installed shortcuts, but has no supported import command.
Signing sends the generated workflow to Apple for validation; it contains only
the generic actions and parameter names, not the user's notes.

Input is a JSON file containing `title`, `scopeText`, and a `tags` array. The
Shortcut finds notes whose Name contains the title and Body contains the scope
text, refuses any count other than one, creates each tag, and calls Notes' native
Add Tags action. It returns `APPLE_NOTES_TAGS_OK` only after those actions.

The MCP accepts the exact CoreData ID and current content hash. Before invoking
the Shortcut, it checks every account for the same title/scope selection and
requires that it resolve only to the supplied ID. It rechecks the revision,
then verifies the exact note's native tags, original non-tag text, links, and
existing native object identifiers. This is optimistic concurrency, not an
atomic transaction spanning Shortcuts, Notes and iCloud. Do not edit or move
the note while the operation runs. After a timeout the server still reads back
the exact note: if all requested tags and original content are verified, it
returns success with a transport warning. Otherwise the outcome is uncertain:
read before retrying, never retry writes automatically.

Use a distinctive existing phrase in the project's note or its full project
name; do not use a textual hashtag as scope. Native Notes search did not resolve
the Shamaal repository path during live testing, although AppleScript found it.
Plain-language phrases such as `Черновик механики для идеи` worked. Do not assume
native search matches arbitrary paths or punctuation literally. Ambiguous matches must be
resolved by choosing a more specific existing marker, not by guessing a title.
The Shortcut does not rewrite or delete note content. Notes determines where
native tags appear; converting every occurrence of textual hashtags is not claimed.

Full-body update/append remains blocked for notes with native objects. Adding
tags does not unlock unsafe rewriting. A future native append/editor capability
is separate from this bridge.

Before project migration, create a temporary note with a unique title/scope,
formatting, Cyrillic hashtags, and a real Notes link. Run the bridge, read it by
ID, verify actual native tags and unchanged links/text, verify idempotence and
stale-token refusal, and remove only that temporary note. Also test duplicate
title/scope selection is rejected. Do not report success from a process exit alone.

Sources: local Notes `Metadata.appintents/extract.actionsdata`; Apple's
[CLI documentation](https://support.apple.com/guide/shortcuts-mac/apd455c82f02/mac)
and [import documentation](https://support.apple.com/guide/shortcuts-mac/apd02bffbaac/mac);
[filter serialization reference](https://github.com/viticci/shortcuts-playground-plugin/blob/main/claude/skills/shortcuts-playground/FILTERS.md).
