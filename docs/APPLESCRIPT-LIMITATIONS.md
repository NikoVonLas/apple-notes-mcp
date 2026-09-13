# AppleScript Limitations

Apple Notes is primarily automated through its AppleScript dictionary. A few
features in the Notes UI are not exposed there. This server reads some of them
from Notes' private `NoteStore.sqlite` store **read-only**, which needs
[Full Disk Access](./FULL-DISK-ACCESS.md), and performs supported native writes
through packaged Apple Shortcuts workflows. Each section distinguishes these
paths so the AppleScript limitations are not mistaken for server limitations.

The full set of properties Notes exposes on a `note` is:

```
container, class, password protected, modification date, creation date,
shared, body, id, name, plaintext
```

(obtained with `properties of note 1 of account "iCloud"`).

## Pinned notes (#28)

**Status: not feasible via AppleScript; readable via the NoteStore database and
writable through the Background Operations Shortcut.**
The Notes UI lets you pin a note to the top of a folder, but the `note` class
has no `pinned` property. Asking for it raises error `-1700`:

```applescript
tell application "Notes"
    set p to pinned of note 1 of account "iCloud"
    -- error -1700: Can't make pinned of note id "x-coredata://…" into type specifier.
end tell
```

There is no alternative property, element, or command (`pin`, `pinned`,
`favorite`, …) in the dictionary. Pinned state lives only in Notes' private
Core Data store (`NoteStore.sqlite`), which is not part of the scriptable
surface.

Reading it, however, did turn out to be worth doing. Since 2.5.0 the BETA
`get-note-metadata` tool queries `ZISPINNED` on `ZICCLOUDSYNCINGOBJECT` in that
store, opened **read-only**, feature-detecting each column with
`PRAGMA table_info` so it degrades instead of breaking when the private schema
changes across macOS releases. It requires
[Full Disk Access](./FULL-DISK-ACCESS.md) and is marked BETA precisely because
the schema is version-dependent.

**Conclusion:** pin state is readable from the NoteStore database with Full Disk
Access. `set-note-pinned` sets an explicit state through the separately installed
Background Operations Shortcut and verifies the result by reading the metadata.

## Note-to-note links (#30)

**Status: link relationships are not exposed to AppleScript; rich-data reads and
the Background Operations Shortcut recover the supported workflows.**
Apple Notes lets you insert a link from one note to another in the UI, but
AppleScript exposes no property or element for that relationship:

- A `note` has no `URL`, `url`, or `link` property — each raises error `-2753`
  (undefined). There is no element that enumerates outgoing/incoming links.
- Nothing in the dictionary inserts a link into a note's body.

A shareable deep link to a note *is* available, and has been since 2.6.0:
`get-note-link` returns a `notes://showNote?identifier=<uuid>` URL that opens
the note in Notes.app on macOS and iOS.

- **Primary path — the NoteStore database.** The UUID in that URL is
  `ZIDENTIFIER` on `ZICCLOUDSYNCINGOBJECT`, read **read-only** from
  `NoteStore.sqlite`. This works on every macOS version but needs
  [Full Disk Access](./FULL-DISK-ACCESS.md).
- **Fallback — AppleScript.** On macOS 12–15 the Notes dictionary does expose a
  two-word `note link` property, used when the database read fails. It is absent
  from the Notes SDEF on macOS 26+, which is why the database is the primary
  path. (`note link` is a different term from the `URL` / `url` / `link` names
  probed above, which genuinely do not exist.)
- Password-protected notes return no link.

The `show` command reveals an object in the Notes UI by id:

```applescript
tell application "Notes" to show note id "x-coredata://…/ICNote/p123"
```

It **is** wrapped, as `show-note`, `show-folder`, `show-account`, and
`show-attachment`. Those tools activate the Notes.app GUI, so they only do
something useful on a machine with an active desktop session; to read a note's
content, use `get-note-content` / `get-note-markdown` instead.

**Conclusion:** `get-note-content` and `get-note-markdown` restore links from the
note's rich data, `get-note-link` retrieves a target deep link, and
`insert-note-link` appends it through the separately installed Background
Operations Shortcut. Dynamic-title link objects and generic AppleScript link
enumeration remain unavailable.

## Tags / hashtags (#29)

**Status: body hashtags and native tags are reported separately; native tag
writes use packaged Shortcuts workflows.** Apple Notes "tags" are inline
`#hashtag` tokens you type into a note's text. They are **not** a scriptable
property — the `note` class exposes no `tags` element, and the tag relationship
lives only in Notes' private Core Data store.

`get-note-content` parses the body and returns textual tags as `hashtags`, while
`nativeTags` reports actual native tag objects recovered from rich data. The
rules match Notes' own behaviour — a token is `#` followed by letters/digits/
underscores containing **at least one letter**, so `#123` is not a tag; tokens
are de-duplicated case-insensitively.

Two related caveats:

- The `tags` parameter on `create-note` does not create native tags. Use
  `add-native-tags` with the separate Native Tags Shortcut after creating and
  reading the note. Plain `#hashtags` remain useful searchable content but are
  not proof of native registration.
- **Smart folders are not scriptable.** Notes' tag-driven Smart Folders cannot be
  created, read, or enumerated via AppleScript; there is no `smart folder` class
  in the dictionary. Only regular folders are scriptable.
