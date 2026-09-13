# Apple Notes Shortcut bridges

The native Apple Notes operations require two packaged Shortcut workflows. Run:

```sh
apple-notes-mcp setup
```

The command checks both workflows and opens only the missing signed files.
Confirm **Add Shortcut** in each macOS window. Connecting an MCP client alone
does not open installation UI. Verify the result with:

```sh
apple-notes-mcp setup --check
```

The MCP `doctor` and `get-capabilities` tools report the same installation state.
macOS may also request Notes access when a workflow runs for the first time.

## Native Tags bridge

`Apple Notes MCP - Native Tags.shortcut` adds actual native Apple Notes tags.
It contains no note contents or credentials. The unsigned source is committed
beside it and can be regenerated with:

```sh
python3 scripts/build-native-tags-shortcut.py
shortcuts sign --mode anyone \
  --input "shortcuts/Apple Notes MCP - Native Tags.unsigned.shortcut" \
  --output "shortcuts/Apple Notes MCP - Native Tags.shortcut"
```

The bridge receives a private temporary JSON file containing a title, a
distinctive existing scope phrase, and normalized tags. The server and workflow
refuse ambiguous note selection. Server readback verifies success and confirms
that existing content survived; command output alone is not proof of a write.

## Background Operations bridge

`Apple Notes MCP - Background Operations v5.shortcut` performs native append,
checklist and table creation, pin state changes, link insertion, and tag removal.
Its allowlist rejects unknown operations. It selects an exact note using its
title and distinctive existing scope text, then the server verifies the revision
and preserved rich content before accepting the result.

Regenerate and test the unsigned source with:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/test-native-operations-shortcut.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/build-native-operations-shortcut.py
shortcuts sign --mode anyone \
  --input "shortcuts/Apple Notes MCP - Background Operations v5.unsigned.shortcut" \
  --output "shortcuts/Apple Notes MCP - Background Operations v5.shortcut"
```

Do not install obsolete workflow versions with the same display name. The
server resolves one exact installed workflow and refuses duplicate names.
