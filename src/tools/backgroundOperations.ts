import { z } from "zod";
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import type { AppleNotesManager } from "../services/appleNotesManager.js";
import {
  appendNative,
  backgroundDependencies,
  backgroundStatus,
  nativeTagBridgeStatus,
  readBackgroundSnapshot,
  mutateBackground,
  assertPreserved,
  setNativeTag,
  localAttachment,
} from "../services/backgroundNotes.js";
import { normalizeNativeTags } from "../services/nativeTags.js";
import { parseNoteTable } from "../utils/noteTables.js";
import { readRichNote } from "../utils/noteRichText.js";

// Enabled only after a live exact-ID preservation test on this build.
export const VERIFIED_BACKGROUND = new Set<string>([
  "append-native",
  "create-checklist-item",
  "create-table",
  "insert-note-link",
  "set-note-pinned",
  "rename-folder",
  "add-attachment",
  "remove-native-tags",
  "replace-native-tag",
]);
const LIVE_VALIDATION_BLOCKERS: Record<string, string> = {};
const signingRefusal =
  "Installed Shortcuts refuses to sign this Notes action (unsupported features); no background fallback is enabled";
export const UNAVAILABLE = {
  "delete-attachment":
    "Notes AppleScript delete returns AppleEvent handler failed; the native Shortcuts delete action also cannot be signed",
  "delete-table":
    "Notes AppleScript delete returns AppleEvent handler failed; the native Shortcuts delete action also cannot be signed",
  "set-checklist-item": signingRefusal,
  "delete-checklist-item": signingRefusal,
  "set-attachment-size": signingRefusal,
  "insert-mention": signingRefusal,
  "update-table-cells":
    "No background cell-editing action; replacing a table would change its identity and position",
  "edit-rich-note":
    "Native text replacement needs current UI selection; full-body rewriting is protected",
  "smart-folders": "No supported background interface for Smart Folder rules",
  "rename-tag-globally":
    "Cannot update Smart Folder references in background; use replace-native-tag on explicit notes",
  "sharing-permissions": "No supported background interface for sharing invitations or permissions",
  "note-lock": "Notes lock actions require the foreground and may require user authentication",
  "record-audio": "Recording requires the Notes UI",
  "transcribe-audio": "No supported background Notes transcription action",
  "scan-and-markup": "No supported background scanning or graphical markup action",
};
function requireValidated(name: string) {
  if (!VERIFIED_BACKGROUND.has(name) && process.env.APPLE_NOTES_MCP_ALLOW_UNVERIFIED !== "1")
    throw new Error(
      (UNAVAILABLE as Record<string, string>)[name] ||
        LIVE_VALIDATION_BLOCKERS[name] ||
        `${name} has not passed live background validation in this build; see get-capabilities`
    );
}
const id = z.string().regex(/^x-coredata:\/\/[0-9a-f-]+\/ICNote\/p\d+$/i);
const revision = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const common = { id, expectedContentHash: revision, scopeText: z.string().min(12).max(500) };
const htmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Register verified native background operations and capability reporting. */
export function registerBackgroundOperations(server: McpServer, manager: AppleNotesManager) {
  function tool<S extends z.ZodRawShape>(
    name: string,
    description: string,
    input: S,
    handler: (args: z.infer<z.ZodObject<S>>) => Record<string, unknown>,
    readOnly = false
  ) {
    server.registerTool(
      name,
      {
        description,
        inputSchema: input,
        outputSchema: z.object({ ok: z.boolean().optional() }).passthrough(),
        annotations: { readOnlyHint: readOnly },
      },
      (async (args: z.infer<z.ZodObject<S>>) => {
        try {
          const result = handler(args as z.infer<z.ZodObject<S>>);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: error instanceof Error ? error.message : "Operation failed",
              },
            ],
            isError: true,
          };
        }
      }) as unknown as ToolCallback<S>
    );
  }
  tool(
    "get-capabilities",
    "Report implemented, live-verified and available background operations and specific limitations; does not open Notes.",
    {},
    () => {
      let bridge: { installed: boolean; shortcut: string; identifier?: string; error?: string };
      try {
        bridge = backgroundStatus();
      } catch {
        bridge = {
          installed: false,
          shortcut: "Apple Notes MCP - Background Operations v5",
          error: "Shortcuts helper unavailable",
        };
      }
      const native = [
        "append-native",
        "create-checklist-item",
        "create-table",
        "set-note-pinned",
        "remove-native-tags",
        "replace-native-tag",
        "insert-note-link",
      ];
      let tagBridgeInstalled = false;
      try {
        tagBridgeInstalled = nativeTagBridgeStatus().installed;
      } catch {
        /* Report unavailable without opening UI. */
      }
      const direct = ["rename-folder", "add-attachment", "delete-attachment", "delete-table"];
      return {
        bridge,
        nativeTagBridgeInstalled: tagBridgeInstalled,
        mode: "background-only",
        operations: Object.fromEntries(
          [...native, ...direct].map((name) => [
            name,
            {
              implemented: true,
              verified: VERIFIED_BACKGROUND.has(name),
              available:
                VERIFIED_BACKGROUND.has(name) &&
                (!native.includes(name) || bridge.installed) &&
                (name !== "replace-native-tag" || tagBridgeInstalled),
              reason: !VERIFIED_BACKGROUND.has(name)
                ? (UNAVAILABLE as Record<string, string>)[name] ||
                  LIVE_VALIDATION_BLOCKERS[name] ||
                  "Live validation pending; install the shortcut and complete the isolated acceptance tests"
                : native.includes(name) && !bridge.installed
                  ? "Run apple-notes-mcp setup and approve Add Shortcut in macOS"
                  : name === "replace-native-tag" && !tagBridgeInstalled
                    ? "Run apple-notes-mcp setup to install the Native Tags bridge for the addition phase"
                    : undefined,
            },
          ])
        ),
        unavailable: UNAVAILABLE,
      };
    },
    true
  );
  tool(
    "get-folder-by-id",
    "Read exact folder name and parent ID before rename.",
    { id: z.string().max(2000) },
    ({ id }) => manager.getFolderById(id),
    true
  );
  tool(
    "rename-folder",
    "Rename a folder in place by exact ID, preserving notes and descendants. Read get-folder-by-id first; rejects stale name/parent and sibling name collisions.",
    {
      id: z.string().max(2000),
      expectedName: z.string().max(1000),
      expectedParentId: z.string().max(2000),
      newName: z.string().min(1).max(1000),
    },
    (args) => {
      requireValidated("rename-folder");
      return {
        ok: true,
        ...manager.renameFolderById(
          args.id,
          args.expectedName,
          args.expectedParentId,
          args.newName
        ),
      };
    }
  );
  tool(
    "append-native",
    "Append formatted content without replacing existing text or native objects. Requires a unique existing scope phrase, exact ID and fresh content hash. Supports semantic HTML, plaintext and Markdown; no embedded media or external fetching.",
    {
      ...common,
      content: z
        .string()
        .min(1)
        .max(1024 * 1024),
      format: z.enum(["plaintext", "html", "markdown"]).default("plaintext"),
    },
    (args) => {
      requireValidated("append-native");
      return appendNative(manager, args);
    }
  );
  tool(
    "get-native-objects",
    "Read native object IDs/types/ranges and checklist IDs/state from the exact note. IDs are returned by Notes, never inferred from titles. Table cell decoding is reported separately.",
    { id },
    ({ id }) => {
      const s = readBackgroundSnapshot(manager, id);
      const tables = (s.rich.objectData || [])
        .filter((o) => o.type?.includes("table"))
        .map((o) => {
          try {
            return {
              id: o.id,
              attachmentId: id.replace(/ICNote\/p\d+$/, `ICAttachment/p${o.pk}`),
              complete: true,
              ...parseNoteTable(Buffer.from(o.mergeable, "hex")),
            };
          } catch (error) {
            return { id: o.id, complete: false, reason: String(error) };
          }
        });
      for (const object of s.rich.objects || [])
        if (object.type.includes("table") && !tables.some((t) => t.id === object.id))
          tables.push({
            id: object.id,
            complete: false,
            reason: "Native table metadata is unavailable",
          });
      return {
        id,
        contentHash: s.hash,
        objects: s.rich.objects,
        checklistItems: s.rich.checklistItems,
        nativeTags: s.rich.nativeTags,
        tables,
        tableCellsComplete: tables.every((t) => t.complete),
      };
    },
    true
  );
  tool(
    "create-checklist-item",
    "Append one real unchecked Notes checklist item while preserving the existing note.",
    {
      ...common,
      text: z
        .string()
        .min(1)
        .max(10000)
        .refine((s) => !/[\r\n\0]/u.test(s), "One line per checklist item"),
    },
    (args) => {
      requireValidated("create-checklist-item");
      const result = mutateBackground(
        args,
        "create-checklist-item",
        { text: args.text },
        (before, after) => {
          assertPreserved(before, after, { append: true });
          const added = after.checklist.slice(before.checklist.length);
          if (added.length !== 1 || added[0].text !== args.text || added[0].done)
            throw new Error("Native checklist item not verified");
        },
        backgroundDependencies(manager)
      );
      return { ...result, items: readRichNote(args.id).checklistItems };
    }
  );
  tool(
    "create-table",
    "Create a native Notes table from rows through native rich-text append. Never substitutes plain text if a native table cannot be verified.",
    {
      ...common,
      rows: z
        .array(z.array(z.string().max(10000)).min(1).max(100))
        .min(1)
        .max(1000),
    },
    (args) => {
      requireValidated("create-table");
      if (args.rows.some((row) => row.length !== args.rows[0].length))
        throw new Error("Table rows must have equal cell counts");
      const before = readRichNote(args.id);
      const content =
        "<table>" +
        args.rows
          .map(
            (row) => "<tr>" + row.map((v) => "<td>" + htmlEscape(v) + "</td>").join("") + "</tr>"
          )
          .join("") +
        "</table>";
      const result = mutateBackground(
        args,
        "append-html",
        { text: "<div><br></div>" + content },
        (oldNote, newNote) => {
          assertPreserved(oldNote, newNote, { append: true });
          const inserted =
            newNote.rich.objectData?.filter(
              (o) => o.type?.includes("table") && !oldNote.rich.nativeObjectIds.includes(o.id)
            ) || [];
          if (
            inserted.length !== 1 ||
            JSON.stringify(parseNoteTable(Buffer.from(inserted[0].mergeable, "hex")).rows) !==
              JSON.stringify(args.rows)
          )
            throw new Error("Native table cells not verified");
        },
        backgroundDependencies(manager)
      );
      const current = readRichNote(args.id);
      const added =
        current.objectData?.filter(
          (obj) => obj.type?.includes("table") && !before.nativeObjectIds.includes(obj.id)
        ) || [];
      if (added.length !== 1)
        throw new Error(
          "Table result uncertain; native table not verified. Read the note before retrying"
        );
      const table = parseNoteTable(Buffer.from(added[0].mergeable, "hex"));
      if (JSON.stringify(table.rows) !== JSON.stringify(args.rows))
        throw new Error("Native table cells not verified; read before retrying");
      return { ...result, table: { id: added[0].id, ...table } };
    }
  );
  tool(
    "set-note-pinned",
    "Set an explicit pinned state without changing the note body; checks expectedPinned to detect metadata conflicts.",
    { ...common, expectedPinned: z.boolean(), pinned: z.boolean() },
    (args) => {
      requireValidated("set-note-pinned");
      const deps = backgroundDependencies(manager);
      const s = deps.read(args.id);
      if (s.hash !== args.expectedContentHash || s.pinned !== args.expectedPinned)
        throw new Error("Note or pinned state changed; read it again");
      if (s.pinned === args.pinned)
        return { ok: true, id: args.id, pinned: s.pinned, contentHash: s.hash, changed: false };
      const run = deps.run;
      deps.run = (input) => {
        if (deps.read(args.id).pinned !== args.expectedPinned)
          throw new Error("Pinned state changed during preflight");
        run(input);
      };
      return {
        ...mutateBackground(
          args,
          "set-pinned",
          { change: args.pinned ? "add" : "remove" },
          (before, after) => {
            assertPreserved(before, after);
            if (after.pinned !== args.pinned) throw new Error("Pinned state not verified");
          },
          deps
        ),
        pinned: args.pinned,
      };
    }
  );
  tool(
    "remove-native-tags",
    "Remove tags from this exact note only. Preserves other native objects; does not globally delete tag definitions.",
    { ...common, tags: z.array(z.string().min(1).max(101)).min(1).max(100) },
    (args) => {
      requireValidated("remove-native-tags");
      let hash = args.expectedContentHash;
      const completed: string[] = [];
      for (const tag of normalizeNativeTags(args.tags)) {
        try {
          const result = setNativeTag(manager, {
            ...args,
            expectedContentHash: hash,
            tag,
            present: false,
          });
          hash = result.contentHash;
          completed.push(tag);
        } catch (error) {
          throw new Error(
            `Stopped after tags ${JSON.stringify(completed)}; read exact note before retry: ${String(error)}`
          );
        }
      }
      return { ok: true, id: args.id, removed: completed, contentHash: hash };
    }
  );
  tool(
    "replace-native-tag",
    "Replace a tag on an explicit list of freshly read notes: add and verify new tag before removing old. Does not rename global Smart Folder rules. Returns per-note outcomes; stops on first uncertain result.",
    {
      notes: z.array(z.object(common)).min(1).max(100),
      oldTag: z.string().min(1).max(101),
      newTag: z.string().min(1).max(101),
    },
    (args) => {
      requireValidated("replace-native-tag");
      const [oldTag] = normalizeNativeTags([args.oldTag]);
      const [newTag] = normalizeNativeTags([args.newTag]);
      if (new Set(args.notes.map((n) => n.id)).size !== args.notes.length)
        throw new Error("Duplicate note IDs");
      for (const n of args.notes)
        if (readBackgroundSnapshot(manager, n.id).hash !== n.expectedContentHash)
          throw new Error("Note revision changed; no replacement started");
      const results: Record<string, unknown>[] = [];
      for (const n of args.notes) {
        try {
          const initial = readBackgroundSnapshot(manager, n.id);
          if (!initial.rich.nativeTags.includes(oldTag) || oldTag === newTag) {
            results.push({ id: n.id, changed: false });
            continue;
          }
          const added = setNativeTag(manager, { ...n, tag: newTag, present: true });
          const removed = setNativeTag(manager, {
            ...n,
            expectedContentHash: added.contentHash,
            tag: oldTag,
            present: false,
          });
          results.push(removed);
        } catch (error) {
          results.push({ id: n.id, ok: false, error: String(error) });
          return { ok: false, results, remaining: args.notes.length - results.length };
        }
      }
      return { ok: true, results };
    }
  );
  tool(
    "list-native-tags",
    "List actual native tags in one explicit account/folder. Also returns exact matching note IDs; partial reads are disclosed.",
    { account: z.string().min(1).max(200), folder: z.string().min(1).max(1000) },
    (args) => {
      const matches: Record<string, string[]> = {};
      const errors: Record<string, string> = {};
      for (const note of manager.listNoteRefs(args.account, args.folder)) {
        try {
          for (const tag of readRichNote(note.id).nativeTags) (matches[tag] ||= []).push(note.id);
        } catch {
          errors[note.id] = "Native metadata unavailable";
        }
      }
      return { tags: matches, complete: Object.keys(errors).length === 0, errors };
    },
    true
  );
  tool(
    "insert-note-link",
    "Append a real retrieved Notes link to a native-object note without replacing its body. Does not create a dynamic-title link object.",
    { ...common, linkedNoteId: id, label: z.string().min(1).max(2000).optional() },
    (args) => {
      requireValidated("insert-note-link");
      const link = manager.getNoteLinkById(args.linkedNoteId);
      if (!link) throw new Error("Real Notes link unavailable");
      const linked = manager.getNoteById(args.linkedNoteId);
      if (!linked) throw new Error("Linked note not found");
      const result = appendNative(manager, {
        ...args,
        content: `<div><a href="${htmlEscape(link)}">${htmlEscape(args.label || linked.title)}</a></div>`,
        format: "html",
      });
      if (
        !readRichNote(args.id).links.some(
          (l) => l.url === link && l.text === (args.label || linked.title)
        )
      )
        throw new Error("Link result uncertain; read note before retrying");
      return result;
    }
  );
  tool(
    "add-attachment",
    "Add a local file to an exact note without replacing its body. Copies input to a private temporary file, verifies inserted bytes and preserves existing objects.",
    { id, expectedContentHash: revision, path: z.string().min(1).max(4096) },
    (args) => {
      requireValidated("add-attachment");
      const before = readBackgroundSnapshot(manager, args.id);
      if (before.hash !== args.expectedContentHash) throw new Error("Note revision changed");
      const bytes = localAttachment(args.path);
      const beforeAttachments = manager.listAttachmentsById(args.id);
      const dir = mkdtempSync(join(tmpdir(), "notes-attachment-add-"));
      const file = join(dir, basename(args.path));
      try {
        writeFileSync(file, bytes, { mode: 0o600 });
        if (readBackgroundSnapshot(manager, args.id).hash !== before.hash)
          throw new Error("Note revision changed");
        let returnedId: string | undefined;
        let transportUncertain = false;
        try {
          returnedId = manager.addAttachmentById(args.id, before.html, file);
        } catch {
          transportUncertain = true;
        }
        const after = readBackgroundSnapshot(manager, args.id);
        assertPreserved(before, after, { append: true });
        // Notes can list the same attachment twice (two rich-text references).
        // Count identities, not list entries; verify bytes for the unique ID.
        const readInserted = () =>
          [...new Map(manager.listAttachmentsById(args.id).map((a) => [a.id, a])).values()].filter(
            (a) => !beforeAttachments.some((b) => b.id === a.id)
          );
        let inserted = readInserted();
        // Notes may expose transient rows while committing an attachment. Retry
        // only the read, never the insertion, for at most one second.
        for (
          let attempt = 0;
          attempt < 4 && (inserted.length !== 1 || (returnedId && returnedId !== inserted[0].id));
          attempt++
        ) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
          inserted = readInserted();
        }
        // Notes can return a temporary CoreData /t... ID before committing /p... .
        // Only persistent IDs are comparable; otherwise exact-note delta and
        // fetched bytes below establish the inserted attachment's identity.
        const persistentReturnedId = returnedId && /\/ICAttachment\/p\d+$/.test(returnedId);
        if (inserted.length !== 1 || (persistentReturnedId && returnedId !== inserted[0].id))
          throw new Error(
            `Attachment insertion outcome uncertain (before: ${beforeAttachments.map((a) => a.id).join(", ")}; new: ${inserted.map((a) => a.id).join(", ")}; returned: ${returnedId || "unavailable"}); read exact note before retrying`
          );
        const attachmentId = inserted[0].id;
        const fetched = manager.getAttachmentBase64ById(args.id, attachmentId);
        const actual =
          typeof fetched.base64 === "string" ? Buffer.from(fetched.base64, "base64") : null;
        if (
          !actual ||
          createHash("sha256").update(actual).digest("hex") !==
            createHash("sha256").update(bytes).digest("hex")
        )
          throw new Error("Attachment bytes not verified; read note before retrying");
        return {
          ok: true,
          id: args.id,
          attachmentId,
          contentHash: after.hash,
          bytes: bytes.length,
          ...(transportUncertain
            ? {
                transportWarning:
                  "Transport was uncertain; inserted file bytes and existing content were verified",
              }
            : {}),
        };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
  const deleteAttachment = (args: {
    id: string;
    expectedContentHash: string;
    attachmentId: string;
  }) => {
    const before = readBackgroundSnapshot(manager, args.id);
    if (before.hash !== args.expectedContentHash) throw new Error("Note revision changed");
    const attachments = manager.listAttachmentsById(args.id);
    if (!attachments.some((a) => a.id === args.attachmentId))
      throw new Error("Attachment does not belong to exact note");
    if (readBackgroundSnapshot(manager, args.id).hash !== before.hash)
      throw new Error("Note revision changed");
    const target = before.rich.objectData?.find(
      (o) => args.attachmentId === args.id.replace(/ICNote\/p\d+$/, `ICAttachment/p${o.pk}`)
    );
    if (!target)
      throw new Error("Cannot map attachment to an exact native object; nothing deleted");
    let transportError: string | undefined;
    try {
      manager.deleteAttachmentById(args.id, before.html, args.attachmentId);
    } catch (error) {
      transportError = String(error);
    }
    const after = readBackgroundSnapshot(manager, args.id);
    const remaining = manager.listAttachmentsById(args.id);
    if (
      remaining.some((a) => a.id === args.attachmentId) ||
      attachments
        .filter((a) => a.id !== args.attachmentId)
        .some((a) => !remaining.some((b) => b.id === a.id))
    )
      throw new Error(
        "Attachment deletion readback failed; read note before retrying" +
          (transportError ? ": " + transportError : "")
      );
    const adjusted = structuredClone(before);
    const ranges = (before.rich.objects || [])
      .filter((o) => o.id === target.id)
      .sort((a, b) => b.start - a.start);
    if (!ranges.length)
      throw new Error("Deleted object range unavailable; read note before retrying");
    for (const range of ranges)
      adjusted.rich.text =
        adjusted.rich.text.slice(0, range.start) +
        adjusted.rich.text.slice(range.start + range.length);
    adjusted.rich.nativeObjectIds = adjusted.rich.nativeObjectIds.filter((id) => id !== target.id);
    adjusted.rich.objectData = adjusted.rich.objectData?.filter((o) => o.id !== target.id);
    assertPreserved(adjusted, after);
    if (after.rich.nativeObjectIds.includes(target.id))
      throw new Error("Native object still present after deletion");
    return { ok: true, id: args.id, contentHash: after.hash, deleted: args.attachmentId };
  };
  tool(
    "delete-table",
    "Delete one native table by the exact attachment ID from get-native-objects, preserving other content.",
    { id, expectedContentHash: revision, attachmentId: z.string().min(1).max(2000) },
    (args) => {
      requireValidated("delete-table");
      const rich = readRichNote(args.id);
      const target = rich.objectData?.find(
        (o) => args.attachmentId === args.id.replace(/ICNote\/p\d+$/, `ICAttachment/p${o.pk}`)
      );
      if (!target?.type?.includes("table"))
        throw new Error("Target is not a verified native table");
      return deleteAttachment(args);
    }
  );
  tool(
    "delete-attachment",
    "Delete an exact attachment belonging to this note, with fresh revision and readback.",
    { id, expectedContentHash: revision, attachmentId: z.string().min(1).max(2000) },
    (args) => {
      requireValidated("delete-attachment");
      return deleteAttachment(args);
    }
  );
}
