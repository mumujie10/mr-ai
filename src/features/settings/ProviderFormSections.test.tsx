import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import "@/lib/i18n";
import { FlatModelSection, ProviderDraftTestSection } from "./ProviderFormSections";
import { MR_DEFAULT_API_FORMAT, providerEntries } from "./providers";
import type { ProviderForm } from "./useProviderForm";
import type { ProviderFormValue } from "./ProviderDialog";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function fakeForm(value: Partial<ProviderFormValue> = {}): ProviderForm {
  const full: ProviderFormValue = {
    name: "Relay",
    remark: "",
    baseUrl: "https://relay.example/v1",
    apiKey: "sk-x",
    model: "gpt-x",
    apiFormat: MR_DEFAULT_API_FORMAT,
    settingsJson: "",
    configToml: "",
    authJson: "",
    ...value,
  };
  return {
    value: full,
    patch: vi.fn(),
    fetchedModels: [],
    fetching: false,
    fetchError: "",
    testing: false,
    testResult: null,
    canTest: true,
    testConnection: vi.fn(),
  } as unknown as ProviderForm;
}

function renderSection(engine: Parameters<typeof FlatModelSection>[0]["engine"]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(<FlatModelSection engine={engine} form={fakeForm()} />);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("provider channel form", () => {
  it("asks the bundled runtime's protocol only for the mr engine", () => {
    const mr = renderSection("minimax");
    expect(mr.container.textContent).toContain("接口协议");
    expect(mr.container.textContent).toContain("OpenAI Chat Completions");
    expect(mr.container.textContent).toContain("Anthropic Messages");
    act(() => mr.root.unmount());

    const kimi = renderSection("kimi");
    expect(kimi.container.textContent).not.toContain("接口协议");
    act(() => kimi.root.unmount());
  });

  it("keeps a stored protocol through the provider row mapping", () => {
    const [entry] = providerEntries("minimax", {
      current: "chan-1",
      providers: {
        "chan-1": {
          name: "Relay",
          baseUrl: "https://relay.example/v1",
          apiKey: "sk-x",
          model: "gpt-x",
          apiFormat: "anthropic-messages",
        },
      },
    });
    expect(entry.apiFormat).toBe("anthropic-messages");
    expect(entry.model).toBe("gpt-x");

    const [legacy] = providerEntries("minimax", {
      current: null,
      providers: { "chan-2": { name: "Old", baseUrl: "https://old.example" } },
    });
    // Absent is surfaced as absent, so the dialog can preselect rather than
    // pretending the CLI was told something.
    expect(legacy.apiFormat).toBe("");
  });
});

describe("渠道草稿的连接测试", () => {
  function renderDraftTest(
    engine: Parameters<typeof ProviderDraftTestSection>[0]["engine"],
    overrides: Partial<ProviderForm> = {},
  ) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const form = { ...fakeForm(), ...overrides };
    const root: Root = createRoot(container);
    act(() => {
      root.render(<ProviderDraftTestSection engine={engine} form={form} />);
    });
    return { container, root, form };
  }

  it("只给内置运行时这一个引擎出现", () => {
    const other = renderDraftTest("kimi");
    expect(other.container.textContent).toBe("");
    act(() => other.root.unmount());

    const mr = renderDraftTest("minimax");
    expect(mr.container.textContent).toContain("测试连接");
    act(() => mr.root.unmount());
  });

  it("表单没填齐时按钮不可用并说明原因", () => {
    const { container, root } = renderDraftTest("minimax", { canTest: false });
    const button = container.querySelector("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(container.textContent).toContain("填好名称、API URL、密钥和模型后即可测试");
    act(() => root.unmount());
  });

  it("失败判定按 CLI 的分类给出可读原因，并带 status 语义", () => {
    const { container, root } = renderDraftTest("minimax", {
      testResult: {
        ok: false,
        state: "failed",
        errorCode: "unauthorized",
        errorMessage: "Authentication failed (HTTP 401)",
      },
    });
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe("密钥被拒绝（401/403）");
    act(() => root.unmount());
  });

  it("成功判定不伪装成错误语气", () => {
    const { container, root } = renderDraftTest("minimax", {
      testResult: { ok: true, state: "available", errorCode: "", errorMessage: "" },
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "连接正常，模型已应答",
    );
    act(() => root.unmount());
  });
});
