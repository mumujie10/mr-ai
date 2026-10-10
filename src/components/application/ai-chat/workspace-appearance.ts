/**
 * Workspace appearance catalog: what 新建工作区 offers and what the sidebar
 * row renders. Stored as `meta.icon` / `meta.color` on the workspace row —
 * `Workspace.meta` is the existing opaque per-workspace bag, so an appearance
 * costs no schema change, and the ids (not component references) are what
 * cross IPC and what an old row reads back.
 */
import Bot from "lucide-react/dist/esm/icons/bot";
import Bell from "lucide-react/dist/esm/icons/bell";
import Bug from "lucide-react/dist/esm/icons/bug";
import Cake from "lucide-react/dist/esm/icons/cake";
import Cat from "lucide-react/dist/esm/icons/cat";
import Coffee from "lucide-react/dist/esm/icons/coffee";
import Cpu from "lucide-react/dist/esm/icons/cpu";
import Crown from "lucide-react/dist/esm/icons/crown";
import FlaskConical from "lucide-react/dist/esm/icons/flask-conical";
import Folder from "lucide-react/dist/esm/icons/folder";
import Gamepad2 from "lucide-react/dist/esm/icons/gamepad-2";
import Ghost from "lucide-react/dist/esm/icons/ghost";
import Library from "lucide-react/dist/esm/icons/library";
import Rocket from "lucide-react/dist/esm/icons/rocket";
import Wine from "lucide-react/dist/esm/icons/wine";
import FolderSymlink from "lucide-react/dist/esm/icons/folder-symlink";
import type { LucideIcon } from "lucide-react";

export interface WorkspaceIconOption {
  id: string;
  icon: LucideIcon;
}

export const WORKSPACE_ICONS: WorkspaceIconOption[] = [
  { id: "folder", icon: Folder },
  { id: "coffee", icon: Coffee },
  { id: "wine", icon: Wine },
  { id: "cake", icon: Cake },
  { id: "gamepad", icon: Gamepad2 },
  { id: "crown", icon: Crown },
  { id: "bot", icon: Bot },
  { id: "cpu", icon: Cpu },
  { id: "bug", icon: Bug },
  { id: "ghost", icon: Ghost },
  { id: "cat", icon: Cat },
  { id: "bell", icon: Bell },
  { id: "flask", icon: FlaskConical },
  { id: "library", icon: Library },
  { id: "rocket", icon: Rocket },
];

/** Fixed hues rather than theme tokens: the color is data the user picked, so
 *  "the green I chose" must be the same green in both themes. */
export const WORKSPACE_COLORS: { id: string; value: string }[] = [
  { id: "pine", value: "#41695B" },
  { id: "green", value: "#47B06A" },
  { id: "blue", value: "#2E7CF6" },
  { id: "amber", value: "#F5B83D" },
  { id: "red", value: "#F25555" },
  { id: "pink", value: "#F2529B" },
  { id: "indigo", value: "#5B4EE0" },
  { id: "yellow", value: "#F2D33D" },
  { id: "orange", value: "#F2823D" },
  { id: "teal", value: "#35BDA4" },
  { id: "sky", value: "#4AA8F2" },
  { id: "gray", value: "#9AA3AD" },
  { id: "ink", value: "#1C2733" },
  { id: "purple", value: "#B48CF2" },
  { id: "mint", value: "#7CCFB0" },
];

export const DEFAULT_WORKSPACE_ICON_ID = "folder";
export const DEFAULT_WORKSPACE_COLOR_ID = "pine";

/** The stored id wins; anything else (a renamed id, a hand-edited meta) falls
 *  back to the folder glyph instead of rendering nothing. */
export function workspaceIconById(id: string | undefined): LucideIcon {
  return WORKSPACE_ICONS.find((option) => option.id === id)?.icon ?? FolderSymlink;
}

export function workspaceColorById(id: string | undefined): string | undefined {
  return WORKSPACE_COLORS.find((option) => option.id === id)?.value;
}
