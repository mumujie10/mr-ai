import FolderSymlink from "lucide-react/dist/esm/icons/folder-symlink";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import ListChecks from "lucide-react/dist/esm/icons/list-checks";
import i18n from "@/lib/i18n";
import { panelTabRegistry } from "@ccgui/plugin-sdk";
import { FilesPanel } from "@/features/files/FilesPanel";
import { ChangesPanel } from "@/features/git/ChangesPanel";
import { TasksPanel } from "./TasksPanel";

/**
 * Builtin right-panel tabs, registered through the same extension-point
 * registry plugins use (plan §4.2 #4 — files/changes are the dogfood
 * surface). Module-scope side effect, imported once by ChatPage; the
 * registry's upsert semantics make HMR re-runs harmless.
 */

/** ChangesPanel keeps its per-workspace remount (key) and full-width class
 *  exactly as it was inlined in ChatSidePanel. */
export const ChangesTab = ({ workspacePath, visible = true }: { workspacePath: string; visible?: boolean }) => (
  <ChangesPanel key={workspacePath} workspacePath={workspacePath} visible={visible} className="w-full" />
);

panelTabRegistry.register({
  id: "tasks",
  label: () => i18n.t("chat.tasksTab"),
  icon: ListChecks,
  // First, before 文件: "what is the agent doing right now" is read before the
  // tree. Negative order so the existing builtin orders (and any plugin tab
  // that picked one) keep their relative slots.
  order: -1,
  component: TasksPanel,
});
panelTabRegistry.register({
  id: "files",
  label: () => i18n.t("files.tab"),
  icon: FolderSymlink,
  order: 0,
  component: FilesPanel,
});
panelTabRegistry.register({
  id: "changes",
  label: () => i18n.t("git.changes"),
  icon: GitBranch,
  order: 1,
  component: ChangesTab,
});
