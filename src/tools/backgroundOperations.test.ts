import { describe, it, expect, vi, afterEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppleNotesManager } from "../services/appleNotesManager.js";
vi.mock("../services/backgroundNotes.js", () => ({
  backgroundStatus: vi.fn(() => ({ installed: false, shortcut: "Background Operations" })),
  nativeTagBridgeStatus: vi.fn(() => ({ installed: false })),
}));
import { registerBackgroundOperations } from "./backgroundOperations.js";
import { backgroundStatus } from "../services/backgroundNotes.js";
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  const registerTool = vi.fn();
  registerBackgroundOperations({ registerTool } as unknown as McpServer, {} as AppleNotesManager);
  return (name: string) => {
    const item = registerTool.mock.calls.find((c) => c[0] === name);
    if (!item) throw new Error("Tool missing");
    return item;
  };
}
describe("background capability boundaries", () => {
  it("requires both bridges for tag replacement, but only the background bridge for removal", async () => {
    vi.mocked(backgroundStatus).mockReturnValueOnce({
      installed: true,
      shortcut: "Background Operations",
    });
    const r = await fixture()("get-capabilities")[2]({});
    expect(r.structuredContent.operations["remove-native-tags"].available).toBe(true);
    expect(r.structuredContent.operations["replace-native-tag"].available).toBe(false);
    expect(r.structuredContent.operations["replace-native-tag"].reason).toMatch(/addition phase/);
  });
  it("discloses missing setup and rejected native actions separately", async () => {
    const get = fixture();
    const r = await get("get-capabilities")[2]({});
    expect(r.structuredContent.bridge.installed).toBe(false);
    expect(r.structuredContent.operations["append-native"].available).toBe(false);
    expect(r.structuredContent.operations["append-native"].verified).toBe(true);
    expect(r.structuredContent.operations["rename-folder"].available).toBe(true);
    expect(r.structuredContent.unavailable["set-checklist-item"]).toMatch(/unsupported features/);
  });
  it("reports live-verified native creation as available with v5 installed", async () => {
    vi.mocked(backgroundStatus).mockReturnValueOnce({
      installed: true,
      shortcut: "Apple Notes MCP - Background Operations v5",
    });
    const r = await fixture()("get-capabilities")[2]({});
    expect(r.structuredContent.operations["append-native"]).toMatchObject({
      verified: true,
      available: true,
    });
    expect(r.structuredContent.operations["create-checklist-item"]).toMatchObject({
      verified: true,
      available: true,
    });
  });
  it("reports a concrete platform failure for disabled attachment deletion", async () => {
    const get = fixture();
    const r = await get("delete-attachment")[2]({});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/AppleEvent/);
  });
  it("uses permissive output schemas for all new tools", () => {
    const get = fixture();
    expect(
      get("get-native-objects")[1].outputSchema.parse({ tables: [], complete: false })
    ).toMatchObject({ tables: [], complete: false });
  });
});
