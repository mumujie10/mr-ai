import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, MemoryDirs } from "@/lib/ipc";

/**
 * 设置 → 记忆: the two 行为 switches must persist through a fresh
 * read-modify-write (never clobbering concurrent edits), and the 存放位置
 * rows must reveal the CLI-owned folders via the resolved paths — the page
 * never touches file contents itself.
 */

const { getAppSettings, updateAppSettings, memoryDirs, revealInFileManager } =
  vi.hoisted(() => ({
    getAppSettings: vi.fn(),
    updateAppSettings: vi.fn(),
    memoryDirs: vi.fn(),
    revealInFileManager: vi.fn(),
  }));
vi.mock("@/lib/ipc", () => ({
  ipc: { getAppSettings, updateAppSettings, memoryDirs, revealInFileManager },
}));

import "@/lib/i18n";
import i18n from "@/lib/i18n";
import { MemorySection } from "./MemorySection";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SETTINGS: AppSettings = {
  theme: "light",
  memoryGlobalEnabled: true,
  memoryProjectEnabled: true,
} as unknown as AppSettings;

const DIRS: MemoryDirs = {
  globalDir: "/Users/t/.mireai/memory",
  projectsDir: "/Users/t/.mireai/memory/projects",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getAppSettings.mockReset().mockResolvedValue({ ...SETTINGS });
  updateAppSettings.mockReset().mockResolvedValue(undefined);
  memoryDirs.mockReset().mockResolvedValue(DIRS);
  revealInFileManager.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(<MemorySection />);
  });
}

function switchByLabel(label: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    `input[role="switch"][aria-label="${label}"]`,
  );
  if (!input) throw new Error(`switch not rendered: ${label}`);
  return input;
}

describe("MemorySection", () => {
  it("renders the spec copy for both toggles and both folder rows", async () => {
    await render();
    const text = container.textContent ?? "";
    expect(text).toContain(i18n.t("settings.memoryBehavior"));
    expect(text).toContain(i18n.t("settings.memoryGlobal"));
    expect(text).toContain(i18n.t("settings.memoryGlobalDesc"));
    expect(text).toContain(i18n.t("settings.memoryProject"));
    expect(text).toContain(i18n.t("settings.memoryProjectDesc"));
    expect(text).toContain(i18n.t("settings.memoryStorage"));
    expect(text).toContain(DIRS.globalDir);
    expect(text).toContain(DIRS.projectsDir);
  });

  it("defaults both toggles to enabled when the settings omit them", async () => {
    getAppSettings.mockResolvedValue({ theme: "light" });
    await render();
    expect(switchByLabel(i18n.t("settings.memoryGlobal")).checked).toBe(true);
    expect(switchByLabel(i18n.t("settings.memoryProject")).checked).toBe(true);
  });

  it("persists a toggle onto a fresh read-modify-write", async () => {
    await render();
    await act(async () => {
      switchByLabel(i18n.t("settings.memoryGlobal")).click();
    });
    expect(updateAppSettings).toHaveBeenCalledTimes(1);
    const persisted = updateAppSettings.mock.calls[0][0] as AppSettings;
    expect(persisted.memoryGlobalEnabled).toBe(false);
    // Fields the user set elsewhere ride along from the fresh read, not from
    // this page's stale state.
    expect(persisted.theme).toBe("light");
    expect(persisted.memoryProjectEnabled).toBe(true);
  });

  it("keeps the old value on screen when the persist fails", async () => {
    updateAppSettings.mockRejectedValue(new Error("disk full"));
    await render();
    await act(async () => {
      switchByLabel(i18n.t("settings.memoryProject")).click();
    });
    expect(switchByLabel(i18n.t("settings.memoryProject")).checked).toBe(true);
    const text = container.textContent ?? "";
    expect(text).toContain("disk full");
  });

  it("reveals each folder by the path the backend resolved", async () => {
    await render();
    const buttons = [...container.querySelectorAll("button")].filter(
      (el) => el.textContent?.trim() === i18n.t("settings.memoryReveal"),
    );
    expect(buttons).toHaveLength(2);
    await act(async () => {
      buttons[0].click();
    });
    await act(async () => {
      buttons[1].click();
    });
    expect(revealInFileManager).toHaveBeenCalledTimes(2);
    expect(revealInFileManager.mock.calls[0][0]).toBe(DIRS.globalDir);
    expect(revealInFileManager.mock.calls[1][0]).toBe(DIRS.projectsDir);
  });
});
