import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { pickDirectory } from "@/lib/platform";
import {
  CreateWorkspaceDialog,
  type WorkspaceCreateInput,
} from "./CreateWorkspaceDialog";

vi.mock("@/lib/platform", () => ({
  pickDirectory: vi.fn(async () => null),
  // 其他 platform 导出按需加；弹框只用到目录选择。
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let created: WorkspaceCreateInput | undefined;
let closed = false;

beforeEach(async () => {
  await i18n.changeLanguage("zh");
  vi.mocked(pickDirectory).mockClear();
  created = undefined;
  closed = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  // ModalShell portals to document.body; clear the overlay between tests.
  document.body.innerHTML = "";
});

function render() {
  act(() => {
    root.render(
      <CreateWorkspaceDialog
        onClose={() => {
          closed = true;
        }}
        onCreate={async (input) => {
          created = input;
        }}
      />,
    );
  });
}

const text = () => document.body.textContent ?? "";
const byLabel = (label: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const createButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "创建",
  );
const nameInput = () =>
  document.querySelector<HTMLInputElement>('input[aria-label="工作区名称"]');

async function pick(path: string | null) {
  vi.mocked(pickDirectory).mockResolvedValue(path);
  await act(async () => {
    // 本文件用真 i18n（zh），可访问名是文案本身，不是键名。
    byLabel("点击添加可读写文件夹")?.click();
  });
}

describe("CreateWorkspaceDialog", () => {
  it("创建在选好源文件夹之前不可用", () => {
    render();
    expect(createButton()?.disabled).toBe(true);
    expect(text()).toContain("点击添加可读写文件夹");
  });

  it("选完文件夹显示路径，创建时把图标/颜色一并交给 onCreate", async () => {
    render();
    await pick("/tmp/My Folder");
    expect(text()).toContain("/tmp/My Folder");
    expect(createButton()?.disabled).toBe(false);

    // 默认外观是第一枚图标与第一个颜色，可换成别的。
    await act(async () => {
      byLabel("bot")?.click();
      byLabel("red")?.click();
    });
    await act(async () => {
      createButton()?.click();
    });
    expect(created).toEqual({
      path: "/tmp/My Folder",
      name: "",
      icon: "bot",
      color: "red",
    });
    // 收尾关闭是宿主 handler 的职责（真实 onCreate 在落库成功后才调
    // onClose）；弹框自己不关，免得创建失败时把用户输的东西吞掉。
    expect(closed).toBe(false);
  });

  it("名称留空时按文件夹名兜底（onCreate 收到空串由别名规则处理）", async () => {
    render();
    await pick("/tmp/My Folder");
    await act(async () => {
      createButton()?.click();
    });
    expect(created?.name).toBe("");
  });

  it("填了名称就原样上交", async () => {
    render();
    await pick("/tmp/My Folder");
    await act(async () => {
      const input = nameInput()!;
      // React 劫持了实例上的 value 属性：必须走原型 setter 再发事件，
      // onChange 才收得到（直接赋值会被 React 的去重逻辑无视）。
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "我的工作台");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      createButton()?.click();
    });
    expect(created?.name).toBe("我的工作台");
  });

  it("取消就是关闭，什么都不创建", async () => {
    render();
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "取消")
        ?.click();
    });
    expect(closed).toBe(true);
    expect(created).toBeUndefined();
  });
});
