# Upstream PR series

This fork is intentionally split before proposing changes to upstream. The
comparison baseline is `sweetrb/apple-notes-mcp` v2.8.4 (`f3f917d`). None of
the tools listed below exist on that baseline, except `get-note-link`, which
already returns a deep link for one note but does not restore links embedded in
note content.

Prepared local branches, stacked in dependency order:

1. `upstream/pr-01-rich-content` — `477b051`
2. `upstream/pr-02-native-inspection` — `1c2fc21`
3. `upstream/pr-03-direct-operations` — `0df0d2d`
4. `upstream/pr-04-native-tags` — `46dfd2c`
5. `upstream/pr-05-native-editing` — `c65cdc4`
6. `upstream/pr-06-shortcut-setup` — `eb49fc9`

## No Shortcut installation

### 1. Preserve rich note content

- Restore embedded link destinations during reads.
- Return `links`, `nativeTags`, `richContentComplete`, and `writable`.
- Preserve restored links in Markdown and guarded HTML updates.
- Include rich metadata in revision checks and stop lossy writes.

This reads `NoteStore.sqlite` without modifying it and therefore needs Full
Disk Access. It does not need an Apple Shortcut.

### 2. Inspect native objects

- Add `get-native-objects` and `list-native-tags`.
- Return native object, checklist, and table identifiers and state.
- Decode table cells while reporting incomplete metadata explicitly.

This also uses read-only database access and needs Full Disk Access, but no
Shortcut.

### 3. Direct Notes operations

- Add `get-folder-by-id` and guarded `rename-folder`.
- Add and verify a local file with `add-attachment`.

These operations use Notes.app's AppleScript interface. macOS may request the
usual Notes Automation permission on first use; no Shortcut is installed.

## Shortcut installation required

### 4. Native tags

- Add `native-tags-status` and `add-native-tags`.
- Package the signed Native Tags workflow and its reproducible generator.
- Verify the exact note, revision, existing links, text, and native objects
  after every mutation.

### 5. Native background editing

- Add `append-native`, `create-checklist-item`, `create-table`,
  `set-note-pinned`, `insert-note-link`, and `remove-native-tags`.
- Add `replace-native-tag`, which uses both bridges until native tag creation
  is proven in the background workflow.
- Add `get-capabilities` so clients can distinguish implemented, installed,
  verified, and unavailable operations.

Only the current verified Background Operations v5 workflow should ship.
Unsupported `delete-attachment` and `delete-table` operations should remain out
of an upstream proposal until macOS accepts and live verification proves them.

## Setup and onboarding

### 6. Explicit bridge setup

- Include the signed workflows in the npm package.
- Add an explicit setup command that checks existing installations, opens only
  missing workflows, and verifies their identifiers afterward.
- Make `doctor` and `get-capabilities` report the exact setup action when a
  bridge is missing.

macOS does not provide a supported silent Shortcut import command. Opening a
signed `.shortcut` file still shows **Add Shortcut**, and the user must approve
it. Notes access may also prompt on first execution. The MCP server therefore
must not open setup windows merely because a client connected. A first-run
wizard or explicit setup command can guide the user through the two approvals,
then all normal operations run without UI automation.

## Dependency order

1. Rich-content preservation.
2. Native-object inspection.
3. Direct Notes operations; independent of the first two where practical.
4. Native Tags bridge; depends on rich-content verification.
5. Background Operations bridge; depends on rich-content and native-object
   verification.
6. Setup and onboarding; depends on both bridge PRs.

Each PR should be rebuilt and tested on the upstream version current at the
time it is submitted. Fork-only history, `LOCAL-CHANGES.md`, obsolete Shortcut
versions, and local installation details do not belong in upstream PRs.
