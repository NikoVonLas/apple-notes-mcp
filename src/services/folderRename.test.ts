import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/utils/applescript.js", () => ({ executeAppleScript: vi.fn() }));
import { executeAppleScript } from "../utils/applescript.js";
import { AppleNotesManager } from "./appleNotesManager.js";
const exec = vi.mocked(executeAppleScript),
  manager = new AppleNotesManager();
const id = "x-coredata://ABC/ICFolder/p12",
  parent = "x-coredata://ABC/ICFolder/p2";
beforeEach(() => vi.clearAllMocks());
describe("folder rename", () => {
  it("renames by ID in place, checking original name, parent and sibling collisions", () => {
    exec.mockReturnValue({ success: true, output: id });
    expect(manager.renameFolderById(id, "R&D", parent, 'Ideas "new"')).toEqual({
      id,
      name: 'Ideas "new"',
      parentId: parent,
    });
    const script = exec.mock.calls[0][0];
    expect(script).toContain('folder id "' + id + '"');
    expect(script).toContain("R&D");
    expect(script).not.toContain("R&amp;D");
    expect(script).toContain('Ideas \\"new\\"');
    expect(script).toContain("A sibling folder already has this name");
    expect(script).not.toMatch(/\b(make new|delete|move)\b/);
    expect(exec.mock.calls[0][1]).toMatchObject({ maxRetries: 1 });
  });
  it("propagates conflicts without repeating mutations", () => {
    exec.mockReturnValue({ success: false, output: "", error: "Folder changed" });
    expect(() => manager.renameFolderById(id, "Before", parent, "After")).toThrow(/changed/);
    expect(exec).toHaveBeenCalledTimes(1);
  });
  it.each(["", "\n", "bad\0name"])("rejects invalid names %j", (name) => {
    expect(() => manager.renameFolderById(id, "Before", parent, name)).toThrow();
    expect(exec).not.toHaveBeenCalled();
  });
  it("rejects a note ID passed as folder ID", () => {
    expect(() =>
      manager.renameFolderById(id.replace("ICFolder", "ICNote"), "Before", parent, "After")
    ).toThrow(/folder ID/);
    expect(exec).not.toHaveBeenCalled();
  });
});
