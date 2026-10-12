import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/base/buttons/button";
import { Switch } from "@/components/base/switch/switch";
import {
  SettingsCard,
  SettingsRow,
  SettingsSectionLabel,
  SettingsValueField,
} from "@/components/application/settings/settings-rows";
import { ipc, type AppSettings, type MemoryDirs } from "@/lib/ipc";

type MemoryPatch = Pick<
  AppSettings,
  "memoryGlobalEnabled" | "memoryProjectEnabled"
>;

/**
 * 设置 → 记忆：两个记忆行为开关立即保存，GUI 侧只落设置——内置引擎
 * (mireai) 下次启动时把它们变成 MAVIS_MEMORY_GLOBAL/PROJECT 环境闸门，CLI
 * 侧据此决定读不读、更不更新长期记忆。存放位置的两行只是指引：目录读写
 * 全归 CLI，这里把文件夹托给系统文件管理器展示，不碰文件内容。
 */
export function MemorySection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [dirs, setDirs] = useState<MemoryDirs | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ipc
      .getAppSettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    ipc
      .memoryDirs()
      .then((d) => {
        if (!cancelled) setDirs(d);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Success notice auto-dismisses; errors stay until the next action.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Read-modify-write onto a fresh read (same funnel as ProxySection) so a
  // whole-object persist never clobbers concurrent edits from other pages.
  // The switches derive from `settings`, so a failed persist simply keeps the
  // old value on screen — nothing to roll back.
  const persist = useCallback(async (patch: MemoryPatch, successMessage: string) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const latest = await ipc.getAppSettings();
      const next = { ...latest, ...patch };
      await ipc.updateAppSettings(next);
      setSettings(next);
      setNotice(successMessage);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  const globalEnabled = settings?.memoryGlobalEnabled ?? true;
  const projectEnabled = settings?.memoryProjectEnabled ?? true;

  const onGlobalToggle = (checked: boolean) => {
    if (saving || !settings) return;
    void persist({ memoryGlobalEnabled: checked }, t("settings.memorySaved"));
  };

  const onProjectToggle = (checked: boolean) => {
    if (saving || !settings) return;
    void persist({ memoryProjectEnabled: checked }, t("settings.memorySaved"));
  };

  const reveal = (path: string | undefined) => {
    if (!path) return;
    setError(null);
    void ipc.revealInFileManager(path).catch((e) => setError(String(e)));
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex w-full flex-col gap-2">
        <SettingsSectionLabel>{t("settings.memoryBehavior")}</SettingsSectionLabel>
        <p className="px-3 text-body-2-regular text-text-secondary">
          {t("settings.memoryDesc")}
        </p>
        <SettingsCard>
          <SettingsRow
            anchor="memoryGlobal"
            label={t("settings.memoryGlobal")}
            description={t("settings.memoryGlobalDesc")}
          >
            <Switch
              size="sm"
              aria-label={t("settings.memoryGlobal")}
              isSelected={globalEnabled}
              isDisabled={!settings || saving}
              onChange={onGlobalToggle}
            />
          </SettingsRow>
          <SettingsRow
            anchor="memoryProject"
            label={t("settings.memoryProject")}
            description={t("settings.memoryProjectDesc")}
          >
            <Switch
              size="sm"
              aria-label={t("settings.memoryProject")}
              isSelected={projectEnabled}
              isDisabled={!settings || saving}
              onChange={onProjectToggle}
            />
          </SettingsRow>
        </SettingsCard>
        <p className="px-3 text-body-2-regular text-text-tertiary">
          {t("settings.memoryHint")}
        </p>
      </div>
      <div className="flex w-full flex-col gap-2">
        <SettingsSectionLabel>{t("settings.memoryStorage")}</SettingsSectionLabel>
        <SettingsCard>
          <SettingsRow
            anchor="memoryGlobalFolder"
            label={t("settings.memoryGlobalFolder")}
            description={t("settings.memoryGlobalFolderDesc")}
          >
            <SettingsValueField muted>{dirs?.globalDir ?? ""}</SettingsValueField>
            <Button
              variant="secondary"
              size="small"
              disabled={!dirs}
              onClick={() => reveal(dirs?.globalDir)}
            >
              {t("settings.memoryReveal")}
            </Button>
          </SettingsRow>
          <SettingsRow
            anchor="memoryProjectsFolder"
            label={t("settings.memoryProjectsFolder")}
            description={t("settings.memoryProjectsFolderDesc")}
          >
            <SettingsValueField muted>{dirs?.projectsDir ?? ""}</SettingsValueField>
            <Button
              variant="secondary"
              size="small"
              disabled={!dirs}
              onClick={() => reveal(dirs?.projectsDir)}
            >
              {t("settings.memoryReveal")}
            </Button>
          </SettingsRow>
        </SettingsCard>
      </div>
      {notice && (
        <p className="px-3 text-body-2-regular text-state-success-text">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="px-3 text-body-2-regular text-text-error-primary">
          {error}
        </p>
      )}
    </div>
  );
}
