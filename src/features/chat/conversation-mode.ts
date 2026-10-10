import { create } from "zustand";

/** 全局形态开关（侧栏顶部胶囊）：整个界面跟着切——会话列表按模式筛
 *  （见 WorkspaceSection 的 threadFilter），右侧栏撤下工作专属页签
 *  （use-panel-tabs），对话模式再撤掉输入框的引擎/权限菜单。发送时它还是
 *  会话的出生 scope：scope=chat 的会话进对话列表，其余（含拆分前没有
 *  标识的老会话）算工作。 */
export type ConversationMode = "chat" | "work";

const STORAGE_KEY = "ccgui-next.conversationMode:v1";

function initialMode(): ConversationMode {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "chat" ? "chat" : "work";
  } catch {
    return "work";
  }
}

interface ConversationModeState {
  mode: ConversationMode;
  setMode: (mode: ConversationMode) => void;
}

export const useConversationMode = create<ConversationModeState>((set) => ({
  mode: initialMode(),
  setMode: (mode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Private browsing: the mode still applies for this run of the app.
    }
    set({ mode });
  },
}));
