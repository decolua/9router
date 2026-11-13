import { vi, describe, expect, it, beforeEach } from "vitest";

// Use vi.hoisted to patch child_process before winElevated.js is imported
const mockExecSync = vi.hoisted(() => vi.fn());

vi.hoisted(() => {
  const child_process = require("child_process");
  child_process.execSync = mockExecSync;
});

// Import after the hoisted patch is executed
import { isAdmin } from "../../src/mitm/winElevated.js";

describe("Windows Admin Privilege Check (winElevated.js)", () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it("returns true when fltmc succeeds (elevated process)", () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    
    const result = isAdmin();
    
    if (process.platform === "win32") {
      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith("fltmc", { windowsHide: true, stdio: "ignore" });
    } else {
      // On non-Windows, it checks process.getuid
      expect(result).toBe(typeof process.getuid === "function" && process.getuid() === 0);
    }
  });

  it("returns false when fltmc throws an error (non-elevated process)", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("Access is denied");
    });
    
    const result = isAdmin();
    
    if (process.platform === "win32") {
      expect(result).toBe(false);
      expect(mockExecSync).toHaveBeenCalledWith("fltmc", { windowsHide: true, stdio: "ignore" });
    } else {
      expect(result).toBe(typeof process.getuid === "function" && process.getuid() === 0);
    }
  });
});
