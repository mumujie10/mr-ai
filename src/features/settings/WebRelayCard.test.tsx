import { vi } from "vitest";

const webRelayStatus = vi.fn();
const webRelayStart = vi.fn();
const webRelayStop = vi.fn();
const webRelayUnattended = vi.fn();
const refreshAppSettings = vi.fn();

vi.mock("@/lib/ipc", () => ({
  ipc: {
    webRelayStatus: () => webRelayStatus(),
    webRelayStart: (url: string, key: string) => webRelayStart(url, key),
    webRelayStop: () => webRelayStop(),
    webRelayUnattended: (enabled: boolean) => webRelayUnattended(enabled),
    refreshAppSettings: () => refreshAppSettings(),
  },
}));

vi.mock("@/lib/events", () => ({
  listenRelay: () => Promise.resolve(() => {}),
  listenSettingsChanged: () => Promise.resolve(() => {}),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "@/lib/i18n";
import { WebRelayCard } from "./WebRelayCard";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};
const CONNECTED = {
  url: "https://relay.example/",
  agentUrl: "wss://relay.example/agent?key=KEY",
  connected: true,
  error: null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  webRelayStatus.mockReset().mockResolvedValue(null);
  webRelayStart.mockReset().mockResolvedValue(CONNECTED);
  webRelayStop.mockReset().mockResolvedValue(undefined);
  webRelayUnattended.mockReset().mockResolvedValue(undefined);
  refreshAppSettings
    .mockReset()
    .mockResolvedValue({ webRelayUnattended: false });

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function switchInput(): HTMLInputElement | null | undefined {
  return container.querySelector<HTMLInputElement>('input[type="checkbox"]');
}

async function render(props: { relayUrl: string; relayKey: string } = { relayUrl: "https://relay.example", relayKey: "KEY" }) {
  await act(async () => {
    root.render(
      <WebRelayCard
        relayUrl={props.relayUrl}
        relayKey={props.relayKey}
        onRelayUrlChange={noop}
        onRelayKeyChange={noop}
        saveRelayFields={async () => {}}
        onInfoRefresh={noop}
      />,
    );
  });
}

describe("WebRelayCard 无人值守", () => {
  it("writes the marker and dials right away when switched on", async () => {
    await render();
    expect(switchInput()?.checked).toBe(false);

    await act(async () => {
      switchInput()?.click();
    });

    expect(webRelayUnattended).toHaveBeenCalledWith(true);
    // The point of the switch is a tunnel that is up, not one that waits for
    // the next launch.
    expect(webRelayStart).toHaveBeenCalledWith("https://relay.example", "KEY");
    expect(switchInput()?.checked).toBe(true);
  });

  it("switching it off only drops the marker, it does not disconnect", async () => {
    refreshAppSettings.mockResolvedValue({ webRelayUnattended: true });
    webRelayStatus.mockResolvedValue(CONNECTED);
    await render();
    expect(switchInput()?.checked).toBe(true);

    await act(async () => {
      switchInput()?.click();
    });

    expect(webRelayUnattended).toHaveBeenCalledWith(false);
    expect(webRelayStop).not.toHaveBeenCalled();
    expect(switchInput()?.checked).toBe(false);
  });

  it("断开中转 clears the marker too — one action means 'do not come back'", async () => {
    refreshAppSettings.mockResolvedValue({ webRelayUnattended: true });
    webRelayStatus.mockResolvedValue(CONNECTED);
    await render();
    const button = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.trim(),
    );
    expect(button?.textContent).toBe("断开中转");

    refreshAppSettings.mockResolvedValue({ webRelayUnattended: false });
    await act(async () => {
      button?.click();
    });

    expect(webRelayStop).toHaveBeenCalled();
    expect(switchInput()?.checked).toBe(false);
  });

  it("写盘失败时不半应用：标记保持后端真实值，连接不断", async () => {
    webRelayUnattended.mockRejectedValue(new Error("settings.json is read-only"));
    await render();

    await act(async () => {
      switchInput()?.click();
    });

    // 拨号没有跟着发生（写入失败即中止），而标记按后端真实值重读回未开。
    expect(webRelayStart).not.toHaveBeenCalled();
    expect(switchInput()?.checked).toBe(false);
    expect(switchInput()?.disabled).toBe(false);
  });

  it("没有地址与密钥时不给开启", async () => {
    await render({ relayUrl: "", relayKey: "" });
    expect(switchInput()?.disabled).toBe(true);
  });
});
