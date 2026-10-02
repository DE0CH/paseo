import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { HostStatusDot } from "@/components/host-status-dot";
import {
  type HostRuntimeConnectionStatus,
  useHostRuntimeConnectionStatus,
} from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { buildHostRootRoute } from "@/utils/host-routes";
import {
  pairWithJarvis,
  startJarvisSession,
  syncJarvis,
  unpairJarvis,
  useJarvisState,
} from "./jarvis";
import { remoteLabel, type JarvisRemote } from "./jarvis-plan";

const STATUS_TEXT: Record<HostRuntimeConnectionStatus, string> = {
  online: "Online",
  connecting: "Connecting…",
  offline: "Offline",
  error: "Offline",
  idle: "Not connected",
};

function modelName(model: string | null | undefined): string | null {
  if (!model) return null;
  return model.split("/").pop() ?? model;
}

export function JarvisSection() {
  const jarvis = useJarvisState();
  const pair = useCallback(() => void pairWithJarvis(), []);
  const refresh = useCallback(() => void syncJarvis(), []);
  const unpair = useCallback(() => void unpairJarvis(), []);

  if (!jarvis.loaded) {
    return (
      <SettingsSection title="Jarvis">
        <SettingsCard>
          <SettingsRow label="Loading…" />
        </SettingsCard>
      </SettingsSection>
    );
  }

  if (!jarvis.paired) {
    return (
      <View testID="jarvis-section">
        <SettingsSection title="Jarvis">
          <SettingsCard>
            <SettingsRow
              label="Pair with Jarvis"
              hint="Sign in to Jarvis once. Every OpenCode session then shows up here and in your hosts, with no pairing links."
              error={jarvis.error ?? undefined}
            >
              <Button
                variant="default"
                size="sm"
                onPress={pair}
                loading={jarvis.pairing}
                testID="jarvis-pair"
              >
                Pair
              </Button>
            </SettingsRow>
          </SettingsCard>
          {jarvis.notice ? (
            <Text style={[settingsStyles.rowHint, styles.notice]}>{jarvis.notice}</Text>
          ) : null}
        </SettingsSection>
      </View>
    );
  }

  return (
    <View testID="jarvis-section">
      <SettingsSection title="Jarvis">
        <SettingsCard>
          <SettingsRow
            label="Paired with Jarvis"
            hint={jarvis.syncing ? "Refreshing…" : "Sessions refresh when the app opens."}
            error={jarvis.error ?? undefined}
          >
            <View style={styles.actions}>
              <Button variant="outline" size="sm" onPress={refresh} testID="jarvis-refresh">
                Refresh
              </Button>
              <Button variant="ghost" size="sm" onPress={unpair} testID="jarvis-unpair">
                Unpair
              </Button>
            </View>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="OpenCode sessions">
        <SettingsCard testID="jarvis-sessions">
          {jarvis.sessions.length === 0 ? (
            <SettingsRow
              label={jarvis.lastSyncAt ? "No OpenCode sessions" : "Loading…"}
              hint="Start one from Jarvis with an OpenRouter model."
            />
          ) : (
            jarvis.sessions.map((session) => (
              <JarvisSessionRow
                key={session.id}
                session={session}
                serverId={jarvis.imports[session.id] ?? null}
                starting={jarvis.starting.includes(session.id)}
              />
            ))
          )}
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}

function JarvisSessionRow({
  session,
  serverId,
  starting,
}: {
  session: JarvisRemote;
  serverId: string | null;
  starting: boolean;
}) {
  const label = remoteLabel(session);
  const model = modelName(session.model);
  const isStarted = session.state === "started" && Boolean(session.pairUrl) && serverId;

  if (isStarted && serverId) {
    return (
      <StartedSessionRow label={label} model={model} serverId={serverId} sessionId={session.id} />
    );
  }

  let status: string;
  let action = null;
  if (session.state === "paused" && !starting) {
    status = "Paused";
    action = <StartButton sessionId={session.id} />;
  } else if (session.state === "started") {
    status = "Waiting for the daemon…";
  } else {
    status = "Starting…";
  }
  return (
    <SettingsRow
      label={label}
      hint={[status, model].filter(Boolean).join(" · ")}
      testID={`jarvis-session-${session.id}`}
    >
      {action}
    </SettingsRow>
  );
}

function StartButton({ sessionId }: { sessionId: string }) {
  const start = useCallback(() => void startJarvisSession(sessionId), [sessionId]);
  return (
    <Button variant="outline" size="sm" onPress={start} testID={`jarvis-start-${sessionId}`}>
      Start
    </Button>
  );
}

function StartedSessionRow({
  label,
  model,
  serverId,
  sessionId,
}: {
  label: string;
  model: string | null;
  serverId: string;
  sessionId: string;
}) {
  const router = useRouter();
  const status = useHostRuntimeConnectionStatus(serverId);
  const open = useCallback(() => router.push(buildHostRootRoute(serverId)), [router, serverId]);
  const dot = useMemo(() => <HostStatusDot serverId={serverId} />, [serverId]);
  return (
    <SettingsRow
      label={label}
      labelAccessory={dot}
      hint={[STATUS_TEXT[status], model].filter(Boolean).join(" · ")}
      testID={`jarvis-session-${sessionId}`}
    >
      <Button variant="outline" size="sm" onPress={open} testID={`jarvis-open-${sessionId}`}>
        Open
      </Button>
    </SettingsRow>
  );
}

const styles = StyleSheet.create((theme) => ({
  actions: { flexDirection: "row", gap: theme.spacing[2] },
  notice: { marginTop: theme.spacing[2] },
}));
