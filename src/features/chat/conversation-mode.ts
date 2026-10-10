import { create } from "zustand";

/** Which composer the sidebar pill selects. 对话 strips the engine/permission
 * controls off the composer; 工作 is the full workspace mode. Also the scope
 * a session is born with — sends file it beside the session id. */
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
