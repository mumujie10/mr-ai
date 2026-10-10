"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus";
import X from "lucide-react/dist/esm/icons/x";
import { ModalShell } from "@/components/dialogs";
import { Input } from "@/components/base/input/input";
import { pickDirectory } from "@/lib/platform";
import { cx } from "@/utils/cx";
import {
  DEFAULT_WORKSPACE_COLOR_ID,
  DEFAULT_WORKSPACE_ICON_ID,
  WORKSPACE_COLORS,
  WORKSPACE_ICONS,
} from "@/components/application/ai-chat/workspace-appearance";

/**
 * 新建工作区 — the dialog the ＋ button opens: source folder, name, icon,
 * color, then create.
 *
 * The native directory picker moved INSIDE the dialog (the dashed area): the
 * user picks the folder, then still gets to name and decorate the workspace
 * before anything is created. The name is optional — an empty field keeps the
 * folder's own name (the alias store clears a name equal to it anyway), so the
 * placeholder shows what the fallback will be rather than inventing a default.
 *
 * Icon/color ride the workspace's existing `meta` bag ({icon, color}); the
 * ids come from the shared appearance catalog so the sidebar renders exactly
 * what was picked.
 */
export interface WorkspaceCreateInput {
  path: string;
  /** Sidebar name; empty keeps the folder's own name. */
  name: string;
  icon: string;
  color: string;
}

export function CreateWorkspaceDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: WorkspaceCreateInput) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [picking, setPicking] = useState(false);
  const [name, setName] = useState("");
  const [iconId, setIconId] = useState(DEFAULT_WORKSPACE_ICON_ID);
  const [colorId, setColorId] = useState(DEFAULT_WORKSPACE_COLOR_ID);
  const folderName = path.split(/[\\/]/).filter(Boolean).pop() ?? "";

  const openPicker = async () => {
    setPicking(true);
    try {
      const picked = await pickDirectory(t("chat.addWorkspace"));
      if (picked) setPath(picked);
    } catch {
      // Picker failed/cancelled: the dialog stays as-is, nothing to report.
    } finally {
      setPicking(false);
    }
  };

  return (
    <ModalShell
      label={t("chat.workspaceCreateTitle")}
      onClose={onClose}
      className="w-[min(560px,94vw)]"
      dialogClassName="flex max-h-[90vh] flex-col overflow-y-auto outline-none"
    >
      <div className="flex items-center justify-between gap-2 pb-4">
        <h2 className="text-body-large text-text-primary">{t("chat.workspaceCreateTitle")}</h2>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={onClose}
          className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h3 className="text-body-2-medium text-text-secondary">{t("chat.workspaceSourceFolder")}</h3>
          <button
            type="button"
            aria-label={t("chat.workspaceSourcePick")}
            onClick={() => void openPicker()}
            disabled={picking}
            className={cx(
              "flex h-44 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 transition-colors",
              path
                ? "border-border-button-active bg-background-tertiary-default"
                : "border-border-button-default text-text-tertiary hover:border-border-button-hover hover:text-text-secondary",
            )}
          >
            {path ? (
              <span className="block max-w-full truncate text-body-2-medium text-text-primary" title={path}>
                {path}
              </span>
            ) : (
              <>
                <FolderPlus className="size-5" aria-hidden />
                <span className="text-body-2-regular">{t("chat.workspaceSourcePick")}</span>
              </>
            )}
          </button>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-body-2-medium text-text-secondary">{t("chat.workspaceNameLabel")}</h3>
          <Input
            aria-label={t("chat.workspaceNameLabel")}
            placeholder={folderName || t("chat.workspaceNamePlaceholder")}
            value={name}
            onChange={setName}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-body-2-medium text-text-secondary">{t("chat.workspaceIconLabel")}</h3>
          <div className="flex flex-wrap gap-1.5">
            {WORKSPACE_ICONS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={iconId === id}
                aria-label={id}
                title={id}
                onClick={() => setIconId(id)}
                className={cx(
                  "flex size-9 cursor-pointer items-center justify-center rounded-lg border transition-colors",
                  iconId === id
                    ? "border-border-button-active bg-background-tertiary-hover text-text-primary"
                    : "border-border-button-default text-text-secondary hover:bg-background-tertiary-hover/55",
                )}
              >
                <Icon className="size-4" aria-hidden />
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-body-2-medium text-text-secondary">{t("chat.workspaceColorLabel")}</h3>
          <div className="flex flex-wrap gap-1.5">
            {WORKSPACE_COLORS.map(({ id, value }) => (
              <button
                key={id}
                type="button"
                aria-pressed={colorId === id}
                aria-label={id}
                title={id}
                onClick={() => setColorId(id)}
                className={cx(
                  "flex size-9 cursor-pointer items-center justify-center rounded-lg border transition-colors",
                  colorId === id
                    ? "border-border-button-active bg-background-tertiary-hover"
                    : "border-transparent hover:bg-background-tertiary-hover/55",
                )}
              >
                <span
                  aria-hidden
                  className="block size-5 rounded-full shadow-xs"
                  style={{ backgroundColor: value }}
                />
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="flex items-center justify-end gap-2 pt-6">
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-lg px-3 py-1.5 text-body-2-medium text-text-secondary transition-colors hover:bg-background-tertiary-hover/55 hover:text-text-primary"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          disabled={!path}
          onClick={() => void onCreate({ path, name, icon: iconId, color: colorId })}
          className={cx(
            "rounded-lg bg-button-primary px-3 py-1.5 text-body-2-medium text-text-white transition-opacity",
            path ? "cursor-pointer" : "cursor-not-allowed opacity-40",
          )}
        >
          {t("chat.workspaceCreate")}
        </button>
      </div>
    </ModalShell>
  );
}
