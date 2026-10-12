import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliConfig, EngineCatalog, EngineInfo, ProviderSection } from "@/lib/ipc";
import { ipc } from "@/lib/ipc";
import "@/lib/i18n";
import i18n from "@/lib/i18n";
import { useEngineModels, type EngineModelsState } from "./use-engine-models";
import { PSEUDO_LOCAL } from "@/features/settings/providers";
import { useModelSettings } from "../model-settings";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    getCliConfig: vi.fn(async () => ({})),
    getAppSettings: vi.fn(async () => ({})),
    listEngineModels: vi.fn(async () => ({ models: [], authoritative: false })),
    mireaiChannelSlugs: vi.fn(async () => [] as { name: string; slug: string }[]),
  },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ENGINE = { id: "omp", enabled: true, available: true } as EngineInfo;
// 模块级稳定引用:与应用内 zustand 提供的 engines 同形。探针记录存在 ref
// 里,数组身份抖动不再引发重复探测(见 use-engine-models 的探针 effect)。
const ENGINES = [ENGINE];
const WS_REMOTE = "//wsl$/Ubuntu/home/u/proj";

let container: HTMLDivElement;
let root: Root;
// 当前 render 的 engines(默认稳定引用;探针类用例按需替换)。
let engines: EngineInfo[] = ENGINES;
let latest: EngineModelsState;

const engineInfo = (id: string, available: boolean): EngineInfo => ({
  id,
  available,
  enabled: true,
  supportsImages: false,
  permissions: [],
});

const noopPin = async () => {};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  engines = ENGINES;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.mocked(ipc.listEngineModels).mockReset();
});

function Harness({
  models,
  pinModels,
  workspacePath,
  providers = {},
}: {
  models: Record<string, string>;
  pinModels: (updates: Record<string, string>, persist?: boolean) => Promise<void>;
  workspacePath?: string;
  /** Session-resolved channel per engine (what the picker refreshes on). */
  providers?: Record<string, string>;
}) {
  latest = useEngineModels(engines, models, pinModels, providers, workspacePath);
  return null;
}

async function render(props: Parameters<typeof Harness>[0]) {
  await act(async () => {
    root.render(<Harness {...props} />);
    // 探针 promise 落地 + catalog 入 store 后的二次 effect 都跑完。
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 让队列中的 promise 回调与随后的 re-render 全部落定:失控的探针循环
 *  会在这么长的窗口里打出成百上千次调用。 */
const settle = () =>
  act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 80);
    await promise;
  });

/** 探针类用例的渲染入口:可换 engines,渲染后等窗口落定。 */
async function show(
  next: EngineInfo[] | null,
  workspacePath?: string,
  providers?: Record<string, string>,
) {
  if (next) engines = next;
  await render({ models: {}, pinModels: noopPin, workspacePath, providers });
  await settle();
}

describe("useEngineModels channel models", () => {
  const EMPTY_SECTION: ProviderSection = { providers: {}, current: null };
  const cliConfigWith = (claude: ProviderSection): CliConfig => ({
    claude,
    kimi: EMPTY_SECTION,
    grok: EMPTY_SECTION,
    codex: EMPTY_SECTION,
    pi: EMPTY_SECTION,
    omp: EMPTY_SECTION,
    dsh: EMPTY_SECTION,
    agy: EMPTY_SECTION,
    opencode: EMPTY_SECTION,
    qoder: EMPTY_SECTION,
    "qoder-cn": EMPTY_SECTION,
    mireai: EMPTY_SECTION,
    minimax: EMPTY_SECTION,
  });

  it("切换渠道后别名行改指该渠道映射的模型", async () => {
    // 报告的问题:选中渠道 ss2a 后模型列表仍是官方 settings.json 解析出的行
    // （后端 catalog 只认 CLI 自己的配置）。渠道自己的 ANTHROPIC_DEFAULT_*_MODEL
    // 才是这次选择真正会跑的 id，切渠道必须让别名行跟着换。
    vi.mocked(ipc.getCliConfig).mockResolvedValue(
      cliConfigWith({
        current: "c1",
        providers: {
          c1: {
            name: "one",
            settingsConfig: { env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "one-opus" } },
          },
          c2: {
            name: "two",
            settingsConfig: { env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "two-opus" } },
          },
        },
      }),
    );
    vi.mocked(ipc.listEngineModels).mockResolvedValue({
      models: [
        { id: "default", name: "Default", description: "Use the default model" },
        { id: "opus", name: "official-opus", description: "Custom Opus model" },
      ],
      authoritative: true,
    } as unknown as EngineCatalog);

    await show([engineInfo("claude", true)], undefined, { claude: "c1" });
    const opusLabel = () =>
      latest.modelsByEngine.claude?.find((model) => model.id === "opus")?.label;
    expect(opusLabel()).toBe("one-opus");
    // The remapped row carries the CLI menu's own subtitle, translated.
    expect(
      latest.modelsByEngine.claude?.find((model) => model.id === "opus")?.description,
    ).toBe(i18n.t("chat.customFamilyModel", { family: "Opus" }));

    await show(null, undefined, { claude: "c2" });
    expect(opusLabel()).toBe("two-opus");
  });

  it("DSH 渠道裸模型 id 与目录的 provider/model 复合 id 合并为一行", async () => {
    // 报告的问题:DSH 选择器里 deepseek-v4-pro(渠道配置的裸 id)与
    // DeepSeek-V4-Pro(catalog 的 deepseek-official/deepseek-v4-pro)重复出现。
    vi.mocked(ipc.getCliConfig).mockResolvedValue({
      ...cliConfigWith(EMPTY_SECTION),
      dsh: {
        current: "ch1",
        providers: { ch1: { name: "Deepseek", model: "deepseek-v4-pro" } },
      },
    });
    vi.mocked(ipc.listEngineModels).mockResolvedValue({
      models: [
        {
          id: "deepseek-official/deepseek-v4-pro",
          name: "DeepSeek-V4-Pro",
          description: "Stronger agentic coding",
          provider: "deepseek-official",
        },
        {
          id: "deepseek-official/deepseek-flash",
          name: "DeepSeek-V41-Flash",
          provider: "deepseek-official",
        },
      ],
      authoritative: true,
    } as unknown as EngineCatalog);

    await show([engineInfo("dsh", true)]);
    const rows = latest.modelsByEngine.dsh ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe("deepseek-official/deepseek-v4-pro");
    expect(rows[0]?.label).toBe("DeepSeek-V4-Pro");
    expect(rows[0]?.description).toBe("Stronger agentic coding");
  });
});

describe("useEngineModels pin effect", () => {
  it("远端(remote)catalog 只做展示:永不触发 pin,不污染全局 models / persisted 默认", async () => {
    vi.mocked(ipc.listEngineModels).mockResolvedValue({
      models: [{ id: "remote-m1", name: "Remote M1" }],
      authoritative: true,
      remote: true,
    } as unknown as EngineCatalog);
    const pinModels = vi.fn(async () => {});
    // stored 与远端 catalog 不相交 —— 修复前这里会 volatile pin,进而在
    // 切回本地工作区时被 persisted pin 覆盖用户保存的默认模型。
    await render({ models: { omp: "user-pick" }, pinModels, workspacePath: WS_REMOTE });
    expect(pinModels).not.toHaveBeenCalled();
  });

  it("本地 authoritative catalog 仍重置过期 stored pick(persist 默认值不变)", async () => {
    vi.mocked(ipc.listEngineModels).mockResolvedValue({
      models: [{ id: "m1", name: "M1" }],
      authoritative: true,
    } as unknown as EngineCatalog);
    const pinModels = vi.fn(async () => {});
    await render({ models: { omp: "stale-id" }, pinModels });
    expect(pinModels).toHaveBeenCalledWith({ omp: "m1" });
  });
});

describe("useEngineModels probe dispatch", () => {
  it("探针失败只派发一次:不会被 pending 抖动反复重发", async () => {
    vi.mocked(ipc.listEngineModels).mockRejectedValue(new Error("DSH host 未运行"));
    await show([engineInfo("dsh", true)]);
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(1);
    expect(latest.pendingEngines).toEqual({});
  });

  it("另一引擎的 catalog 落地不会连带重试失败引擎", async () => {
    vi.mocked(ipc.listEngineModels).mockImplementation(async (id: string) => {
      if (id === "dsh") throw new Error("DSH host 未运行");
      return { models: [{ id: "pi/m1", provider: "pi" }], authoritative: true };
    });
    await show([engineInfo("dsh", true), engineInfo("pi", true)]);
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(2);
    expect(latest.catalogs.pi?.models[0]?.id).toBe("pi/m1");
    await settle();
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(2);
  });

  it("refresh 重探所有引擎(失败者也算)", async () => {
    vi.mocked(ipc.listEngineModels).mockRejectedValue(new Error("down"));
    await show([engineInfo("dsh", true)]);
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(1);
    vi.mocked(ipc.listEngineModels).mockResolvedValue({
      models: [{ id: "deepseek/x", provider: "deepseek" }],
      authoritative: true,
    });
    await act(async () => {
      await latest.refresh();
    });
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(2);
    expect(latest.catalogs.dsh?.models[0]?.id).toBe("deepseek/x");
  });

  it("引擎可用性翻转后允许再探一次", async () => {
    vi.mocked(ipc.listEngineModels).mockRejectedValue(new Error("missing CLI"));
    await show([engineInfo("dsh", false)]);
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(1);
    await show([engineInfo("dsh", true)]);
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(2);
  });

  it("探针记录按工作区隔离", async () => {
    vi.mocked(ipc.listEngineModels).mockRejectedValue(new Error("down"));
    await show([engineInfo("dsh", true)], "/ws-a");
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(1);
    await show(null, "/ws-b");
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ipc.listEngineModels).mock.calls.map((call) => call[1])).toEqual([
      "/ws-a",
      "/ws-b",
    ]);
  });
});

describe("useEngineModels refresh scope", () => {
  it("刷新模型全局生效:本地工作区共用一份目录,刷新后切到别的工作区也是新目录", async () => {
    vi.mocked(ipc.listEngineModels).mockResolvedValue({
      models: [{ id: "stale-m", provider: "pi" }],
      authoritative: true,
    } as unknown as EngineCatalog);
    // 两个本地工作区各探一次(靠首次应答认定是本地上下文),之后共用同一份目录。
    await show([engineInfo("omp", true)], "/ws-a");
    await show(null, "/ws-b");
    expect(latest.catalogs.omp?.models[0]?.id).toBe("stale-m");

    vi.mocked(ipc.listEngineModels).mockClear();
    vi.mocked(ipc.listEngineModels).mockResolvedValue({
      models: [{ id: "fresh-m", provider: "pi" }],
      authoritative: true,
    } as unknown as EngineCatalog);
    // 在 /ws-b 刷新 —— 修复前这里只更新当前工作区的桶,/ws-a 会一直停在旧目录。
    await act(async () => {
      await latest.refresh();
    });
    expect(latest.catalogs.omp?.models[0]?.id).toBe("fresh-m");

    // 回到另一个本地工作区读到的也是刷新后的目录。
    await show(null, "/ws-a");
    expect(latest.catalogs.omp?.models[0]?.id).toBe("fresh-m");
  });

  it("远端(发行版)目录独立成桶,刷新时两个上下文一并更新", async () => {
    const catalogFor = (ws?: string): EngineCatalog =>
      ws === WS_REMOTE
        ? ({ models: [{ id: "distro-m", provider: "pi" }], authoritative: true, remote: true } as EngineCatalog)
        : ({ models: [{ id: "local-m", provider: "pi" }], authoritative: true } as EngineCatalog);
    vi.mocked(ipc.listEngineModels).mockImplementation(async (_engine, ws) => catalogFor(ws));
    await show([engineInfo("omp", true)], "/ws-local");
    expect(latest.catalogs.omp?.models[0]?.id).toBe("local-m");

    await show(null, WS_REMOTE);
    expect(latest.catalogs.omp?.models[0]?.id).toBe("distro-m");

    // 刷新:本地上下文 + 已缓存的远端上下文都在范围内。
    vi.mocked(ipc.listEngineModels).mockImplementation(async (_engine, ws) =>
      ws === WS_REMOTE
        ? ({ models: [{ id: "distro-new", provider: "pi" }], authoritative: true, remote: true } as EngineCatalog)
        : ({ models: [{ id: "local-new", provider: "pi" }], authoritative: true } as EngineCatalog),
    );
    await act(async () => {
      await latest.refresh();
    });
    expect(latest.catalogs.omp?.models[0]?.id).toBe("distro-new");

    // 回到本地工作区:本地目录同样刷新过,且没有被发行版目录污染。
    await show(null, "/ws-other");
    expect(latest.catalogs.omp?.models[0]?.id).toBe("local-new");
  });
});

describe("模型设置隐藏的行", () => {
  afterEach(() => {
    useModelSettings.setState({ byKey: {}, loaded: false });
  });

  it("藏掉的行不进选择器，但当前选中的那一行永远留着", async () => {
    useModelSettings.setState({
      byKey: {
        "omp::pi/m-hidden": { hidden: true },
        "omp::pi/m-picked": { hidden: true },
      },
      loaded: true,
    });
    vi.mocked(ipc.listEngineModels).mockResolvedValue({
      models: [
        { id: "pi/m-shown", name: "Shown" },
        { id: "pi/m-hidden", name: "Hidden" },
        { id: "pi/m-picked", name: "Picked" },
      ],
      authoritative: true,
    } as unknown as EngineCatalog);
    await render({ models: { omp: "pi/m-picked" }, pinModels: async () => {} });
    const ids = (latest.modelsByEngine.omp ?? []).map((m) => m.id);
    expect(ids).toContain("pi/m-shown");
    expect(ids).not.toContain("pi/m-hidden");
    // 会话正在跑的那一行即使被藏也留在列表里:把它从选择器上抹掉会让胶囊变空，
    // 用户也再没法切回来。
    expect(ids).toContain("pi/m-picked");
  });
});

describe("useEngineModels 渠道分组", () => {
  const baseConfig = (): CliConfig => {
    const section: ProviderSection = { providers: {}, current: null };
    return {
      claude: section,
      kimi: section,
      grok: section,
      codex: section,
      pi: section,
      omp: section,
      dsh: section,
      agy: section,
      opencode: section,
      qoder: section,
      "qoder-cn": section,
      mireai: section,
      minimax: section,
    };
  };

  afterEach(() => {
    vi.mocked(ipc.mireaiChannelSlugs).mockReset();
    vi.mocked(ipc.mireaiChannelSlugs).mockResolvedValue([]);
  });

  // 内置运行时一次上报的模型菜单含所有渠道的行(CLI 就是这么给的),所以选中的
  // 渠道决定看到哪些行。渠道 → slug 只能问 CLI:同名重存会让 CLI fork 出
  // llm-2,模型 id 前缀跟着变。
  const threeChannelCatalog = {
    models: [
      { id: "minimax/MiniMax-M2.7", name: "MiniMax-M2.7", provider: "minimax" },
      { id: "llm-2/MiniMax-M3", name: "MiniMax-M3", provider: "llm-2" },
      { id: "probe-a/model-alpha", name: "model-alpha", provider: "probe-a" },
    ],
    authoritative: true,
  } as unknown as EngineCatalog;

  it("选供应商渠道就只看这个渠道自己的模型", async () => {
    vi.mocked(ipc.getCliConfig).mockResolvedValue({
      ...baseConfig(),
      mireai: {
        current: "ch-llm",
        providers: { "ch-llm": { name: "llm" }, "ch-probe": { name: "probe-a" } },
      },
    });
    vi.mocked(ipc.listEngineModels).mockResolvedValue(threeChannelCatalog);
    vi.mocked(ipc.mireaiChannelSlugs).mockResolvedValue([
      { name: "llm", slug: "llm-2" },
      { name: "probe-a", slug: "probe-a" },
    ]);
    await show([engineInfo("mireai", true)]);
    expect((latest.modelsByEngine.mireai ?? []).map((m) => m.id)).toEqual([
      "llm-2/MiniMax-M3",
    ]);

    // 换到另一个渠道,列表跟着换成那个渠道的模型 —— 用户报的就是这一步没跟。
    await show(null, undefined, { mireai: "ch-probe" });
    expect((latest.modelsByEngine.mireai ?? []).map((m) => m.id)).toEqual([
      "probe-a/model-alpha",
    ]);

    // 渠道记录没了(别处删的)不猜:整表摆出来,而不是把官方配置的行冒充成它的。
    await show(null, undefined, { mireai: "ch-gone" });
    expect((latest.modelsByEngine.mireai ?? []).map((m) => m.id)).toHaveLength(3);
  });

  it("官方配置列运行时自己跑的模型,本 App 管的渠道不混进来", async () => {
    vi.mocked(ipc.getCliConfig).mockResolvedValue({
      ...baseConfig(),
      mireai: { current: null, providers: { "ch-llm": { name: "llm" } } },
    });
    vi.mocked(ipc.listEngineModels).mockResolvedValue(threeChannelCatalog);
    vi.mocked(ipc.mireaiChannelSlugs).mockResolvedValue([{ name: "llm", slug: "llm-2" }]);
    await show([engineInfo("mireai", true)]);
    // llm-2 归那个渠道;minimax 与 probe-a(用户只在 CLI 里配过)都还是 CLI 自己
    // 在跑的东西,官方配置下面照样能选——不收窄不存在的那部分。
    expect((latest.modelsByEngine.mireai ?? []).map((m) => m.id)).toEqual([
      "minimax/MiniMax-M2.7",
      "probe-a/model-alpha",
    ]);
  });

  it("问不到 slug 时不收窄:宁可多列也不把渠道自己的模型藏掉", async () => {
    vi.mocked(ipc.getCliConfig).mockResolvedValue({
      ...baseConfig(),
      mireai: { current: "ch-llm", providers: { "ch-llm": { name: "llm" } } },
    });
    vi.mocked(ipc.listEngineModels).mockResolvedValue(threeChannelCatalog);
    vi.mocked(ipc.mireaiChannelSlugs).mockRejectedValue(new Error("mr 未安装"));
    await show([engineInfo("mireai", true)]);
    expect((latest.modelsByEngine.mireai ?? []).map((m) => m.id)).toHaveLength(3);
  });

  it("模型设置拿到的是每个渠道各自的行,一个渠道都不少", async () => {
    vi.mocked(ipc.getCliConfig).mockResolvedValue({
      ...baseConfig(),
      mireai: {
        current: "ch-llm",
        providers: { "ch-llm": { name: "llm" }, "ch-probe": { name: "probe-a" } },
      },
    });
    vi.mocked(ipc.listEngineModels).mockResolvedValue(threeChannelCatalog);
    vi.mocked(ipc.mireaiChannelSlugs).mockResolvedValue([
      { name: "llm", slug: "llm-2" },
      { name: "probe-a", slug: "probe-a" },
    ]);
    await show([engineInfo("mireai", true)]);
    const byChannel = latest.modelsByChannel.mireai ?? {};
    expect(Object.keys(byChannel)).toEqual([PSEUDO_LOCAL, "ch-llm", "ch-probe"]);
    expect(byChannel[PSEUDO_LOCAL].map((m) => m.id)).toEqual(["minimax/MiniMax-M2.7"]);
    expect(byChannel["ch-llm"].map((m) => m.id)).toEqual(["llm-2/MiniMax-M3"]);
    expect(byChannel["ch-probe"].map((m) => m.id)).toEqual(["probe-a/model-alpha"]);
  });

  it("内置引擎恒列出官方渠道,其他引擎照旧", async () => {
    vi.mocked(ipc.getCliConfig).mockResolvedValue(baseConfig());
    await show([engineInfo("mireai", true), engineInfo("omp", true)]);
    expect((latest.channelsByEngine.mireai ?? []).map((c) => c.kind)).toEqual(["official"]);
    expect(latest.channelsByEngine.omp ?? []).toEqual([]);
  });

  it("只有内置引擎按渠道分行:别的引擎每个渠道跑同一批别名行", async () => {
    // claude/kimi 这些引擎的菜单是 CLI 自己的别名行,不随渠道变成不同的一批,
    // 按渠道分段只会把同一批行重复抄几遍。
    vi.mocked(ipc.getCliConfig).mockResolvedValue({
      ...baseConfig(),
      claude: { current: "c1", providers: { c1: { name: "one" }, c2: { name: "two" } } },
    });
    vi.mocked(ipc.listEngineModels).mockResolvedValue(threeChannelCatalog);
    vi.mocked(ipc.mireaiChannelSlugs).mockResolvedValue([{ name: "llm", slug: "llm-2" }]);
    await show([engineInfo("claude", true)]);
    expect(latest.modelsByChannel.claude).toBeUndefined();
    expect((latest.modelsByEngine.claude ?? []).map((m) => m.id)).toHaveLength(3);
  });

  it("刷新强制重读渠道 slug", async () => {
    await show([engineInfo("mireai", true)]);
    vi.mocked(ipc.mireaiChannelSlugs).mockClear();
    await act(async () => {
      await latest.refresh();
    });
    expect(ipc.mireaiChannelSlugs).toHaveBeenCalledWith(true);
  });
});
