// Repro fixture: the REAL ConversationFooter (same composer the session
// page uses) with an active session seeded into the real chat store, plus
// seeded agent/prompt catalogs. Type `#` / `!` in the field to exercise the
// pickers exactly as the app does. Probe: after typing, document body text
// must contain 我的智能体 / 新建智能体 (agent menu) or 新建提示词.
// The composer's bottom row also carries the real engine pill on the right, so
// the pill's own width and the two-card popover row (model flyout, then the
// engine list nearest the pill) can be checked against the window edge.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "../../src/index.css";
import "../../src/lib/i18n";
import {
  CliMenu,
  type EffortLevel,
} from "../../src/components/application/ai-chat/cli-menu";
import { ConversationFooter } from "../../src/features/chat/components/ConversationFooter";
import { useChatStore } from "../../src/features/chat/store";
import { useBotStore } from "../../src/features/bots/bot-store";
import type { BotConfig } from "../../src/lib/ipc";
import { usePromptStore } from "../../src/features/prompts/prompt-store";

const ROOT = "/fixture-ws";

const makeBot = (
  overrides: Partial<BotConfig> & Pick<BotConfig, "id" | "name">,
): BotConfig => ({
  slug: overrides.id,
  title: null,
  description: null,
  avatar: { type: "emoji", value: "🔍" },
  soul: "",
  instructions: "",
  capabilities: { skills: [], tools: [], mcpServers: [] },
  runtime: { kind: "direct", model: null, cwd: null, extraArgs: [], permissionMode: "ask" },
  memory: {
    enabled: true,
    writeApproval: false,
    memoryCharLimit: 2200,
    reviewEnabled: true,
    reviewEveryNTurns: 5,
  },
  source: "custom",
  builtinId: null,
  pinned: false,
  hidden: false,
  schemaVersion: 1,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

useBotStore.setState({
  bots: [
    makeBot({
      id: "a1",
      name: "代码审查员",
      title: "严格的守门员",
      description: "只挑会影响运行的毛病。",
    }),
  ],
  builtInAgents: [],
  builtInDivisions: [],
  loaded: true,
  refresh: async () => {},
});
usePromptStore.setState({
  byRoot: {
    [ROOT]: {
      entries: [
        { name: "review", path: "/fixture-ws/.ccgui/prompts/review.md", description: "逐行审查", content: "请审查…", scope: "workspace" },
      ],
      status: "ready",
      fetchedAt: Date.now(),
    },
  },
  ensure: () => {},
  refresh: async () => {},
});

const ACTIVE = { engine: "claude", sessionId: "s-1", workspacePath: ROOT };

// The real engine pill in the real toolbar slot: the pill sits on the
// composer's right and its popover is right-aligned, so this fixture is the
// place to see whether the panel and the model flyout stay inside the window.
const MODEL_ROWS = [
  { id: "llm/MiniMax-M3", label: "MiniMax-M3", provider: "llm" },
  { id: "minimax/MiniMax-M2.7", label: "MiniMax-M2.7", provider: "minimax" },
  { id: "zhipu/glm-4.7", label: "glm-4.7", provider: "zhipu" },
];

function Fixture() {
  const [draft, setDraft] = useState("");
  const [engine, setEngine] = useState("claude");
  const [model, setModel] = useState(MODEL_ROWS[0].id);
  const [effort, setEffort] = useState<EffortLevel>("medium");
  return (
    <div className="flex min-h-dvh flex-col justify-end bg-background-primary-default">
      <ConversationFooter
        active={ACTIVE}
        workspaces={[]}
        queue={[]}
        onRemoveQueued={() => {}}
        onMoveQueued={() => {}}
        onSendQueuedNow={() => {}}
        imageError={null}
        branchError={null}
        onDismissImageError={() => {}}
        onDismissBranchError={() => {}}
        images={[]}
        previews={{}}
        onRemoveImage={() => {}}
        draft={draft}
        onDraftChange={setDraft}
        onSubmit={() => {}}
        sendShortcut="enter"
        onStop={() => {}}
        streaming={false}
        noEnabledEngines={false}
        composerInputRef={{ current: null }}
        addMenu={null}
        cliMenu={
          <CliMenu
            options={[{ id: "claude", label: "MireAI CLI", available: true }]}
            value={engine}
            onChange={setEngine}
            modelsByEngine={{ claude: MODEL_ROWS }}
            models={{ claude: model }}
            onModelChange={(_, id) => setModel(id)}
            efforts={{ claude: effort }}
            onEffortChange={(_, level) => setEffort(level)}
            channelsByEngine={{}}
            selectedChannels={{}}
            onChannelChange={() => {}}
            ompServiceTier={null}
            onOmpServiceTierChange={async () => {}}
            codexServiceTier={null}
            onCodexServiceTierChange={async () => {}}
          />
        }
        permissionMenu={null}
        supportsImages={false}
        onPasteImages={() => {}}
        sessionUsage={null}
        contextMax={0}
        branch={undefined}
        branches={undefined}
        onBranchSelect={() => {}}
        startNewChat={() => {}}
      />
    </div>
  );
}

createRoot(document.getElementById("fixture")!).render(
  <HashRouter>
    <Fixture />
  </HashRouter>,
);
