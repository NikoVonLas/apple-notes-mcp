import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppleNotesManager } from "../services/appleNotesManager.js";
const mock = vi.hoisted(() => ({ preserve: vi.fn(), snapshot: vi.fn() }));
vi.mock("../services/backgroundNotes.js", () => ({
  readBackgroundSnapshot: mock.snapshot,
  assertPreserved: mock.preserve,
  localAttachment: () => Buffer.from("Кириллица 🧭"),
}));
import { registerBackgroundOperations } from "./backgroundOperations.js";
afterEach(() => vi.resetAllMocks());

describe("attachment insertion readback", () => {
  it.each([true, false])("deduplicates native references and verifies bytes=%s", async (valid) => {
    const id = "x-coredata://ABC/ICNote/p1";
    const attachmentId = "x-coredata://ABC/ICAttachment/p3";
    mock.snapshot.mockReturnValue({ id, hash: "revision", html: "existing" });
    const manager = {
      listAttachmentsById: vi
        .fn()
        .mockReturnValueOnce([{ id: "existing" }])
        .mockReturnValue([{ id: "existing" }, { id: attachmentId }, { id: attachmentId }]),
      addAttachmentById: vi.fn(() => attachmentId),
      getAttachmentBase64ById: vi.fn(() => ({
        base64: Buffer.from(valid ? "Кириллица 🧭" : "wrong bytes").toString("base64"),
      })),
    };
    const registerTool = vi.fn();
    registerBackgroundOperations(
      { registerTool } as unknown as McpServer,
      manager as unknown as AppleNotesManager
    );
    const handler = registerTool.mock.calls.find((c) => c[0] === "add-attachment")![2];
    const result = await handler({ id, expectedContentHash: "revision", path: "/tmp/example.txt" });
    expect(manager.addAttachmentById).toHaveBeenCalledTimes(1);
    expect(mock.preserve).toHaveBeenCalledTimes(1);
    expect(manager.getAttachmentBase64ById).toHaveBeenCalledWith(id, attachmentId);
    if (valid) expect(result.structuredContent).toMatchObject({ ok: true, attachmentId });
    else {
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/bytes not verified/);
    }
  });
});
