import { useCallback, useEffect, useState } from "react";
import { ipc } from "@/lib/ipc";
import { WebRelayDeployCard } from "./WebRelayDeployCard";
import { WebRelayCard } from "./WebRelayCard";
import { WebAuthCard } from "./WebAuthCard";
import { WebDevicesCard } from "./WebDevicesCard";

/**
 * 外网访问 pane: relay deploy, relay connection, pairing authorization, and
 * device approvals. The relay URL/key fields are shared between the deploy
 * card (which fills them) and the relay card (which edits them), so they live
 * here.
 */
export function WebWanPane({ onInfoRefresh }: { onInfoRefresh: () => void }) {
  const [relayUrl, setRelayUrl] = useState("");
  const [relayKey, setRelayKey] = useState("");

  useEffect(() => {
    void ipc
      .getAppSettings()
      .then((s) => {
        setRelayUrl(s.webRelayUrl ?? "");
        setRelayKey(s.webRelayKey ?? "");
      })
      .catch(() => {});
  }, []);

  const saveRelayFields = useCallback(async (url: string, key: string) => {
    // De-cached read on purpose: 无人值守 is written by its own command (and by
    // a phone over the bridge), never through this funnel, so a cached copy
    // would carry the marker from before that write and the spread below would
    // quietly revert it while saving the address.
    const latest = await ipc.refreshAppSettings();
    await ipc.updateAppSettings({ ...latest, webRelayUrl: url || null, webRelayKey: key || null });
  }, []);

  return (
    <>
      <div className="flex w-full items-stretch gap-2">
        <div className="flex min-w-0 flex-1">
          <WebRelayDeployCard
            relayKey={relayKey}
            onRelayKeyChange={setRelayKey}
            onDeployed={(url, key) => {
              setRelayUrl(url);
              setRelayKey(key);
            }}
            saveRelayFields={saveRelayFields}
          />
        </div>
        <div className="flex min-w-0 flex-1">
          <WebRelayCard
            relayUrl={relayUrl}
            relayKey={relayKey}
            onRelayUrlChange={setRelayUrl}
            onRelayKeyChange={setRelayKey}
            saveRelayFields={saveRelayFields}
            onInfoRefresh={onInfoRefresh}
          />
        </div>
        <div className="flex min-w-0 flex-1">
          <WebAuthCard />
        </div>
      </div>
      <WebDevicesCard />
    </>
  );
}
