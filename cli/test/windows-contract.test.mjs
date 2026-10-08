import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";
import { checkWindowsSourceLocation } from "../scripts/check-windows-source-location.mjs";
import { resolveWslPath } from "../packages/tui/src/host/wsl-path.js";

const windowsPath = String.raw`D:\Users\demo\Documents\Screen shots\截图.png`;
const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 4 });
  }
});

describe.skipIf(process.platform !== "win32")("Windows source contract", () => {
  // The check spawns PowerShell and queries CIM with its own 15 s timeout; cold
  // Windows runners can exceed Vitest's 5 s default before that query returns.
  it("accepts the Windows checkout on a local NTFS volume", () => {
    assert.deepEqual(checkWindowsSourceLocation({ allowNonFixed: false }), {
      ok: true,
      skipped: false,
    });
  }, 30_000);

  it("preserves Windows path syntax on the native host", async () => {
    assert.equal(await resolveWslPath(windowsPath), windowsPath);
  });

});
