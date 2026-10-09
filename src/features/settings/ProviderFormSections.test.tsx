import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import "@/lib/i18n";
import { FlatModelSection } from "./ProviderFormSections";
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
