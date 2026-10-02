// Jarvis (Deyao's self-hosted session controller) as a source of hosts: pair
// this install with Jarvis once, then import every OpenCode session's daemon
// automatically, named after the session, and drop the ones that are gone.
// API: selfhost/API.md in DE0CH/claude-env (/api/devices/pair, /api/remotes).
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { useSyncExternalStore } from "react";
import { AppState, Platform, Settings } from "react-native";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  isAccessRefusal,
  parsePairRedirect,
  planJarvisSync,
  type JarvisImports,
  type JarvisRemote,
} from "./jarvis-plan";

interface JarvisExtra {
  url: string;
  scheme: string;
}

const jarvisExtra = (Constants.expoConfig?.extra as { jarvis?: JarvisExtra } | undefined)?.jarvis;

/** The Jarvis integration exists only in Deyao's iOS build (APP_VARIANT=de0ch). */
export const isJarvisEnabled = Platform.OS === "ios" && Boolean(jarvisExtra);

const TOKEN_KEY = "jarvis-device-token";
const IMPORTS_KEY = "@paseo-de0ch:jarvis-imports";
// A token minted seconds ago is refused until Cloudflare propagates it.
const PROPAGATION_GRACE_MS = 30_000;
const REFRESH_WHILE_CHANGING_MS = 5_000;

interface DeviceToken {
  id: string;
  clientId: string;
  clientSecret: string;
  pairedAt: number;
}

export interface JarvisState {
  loaded: boolean;
  paired: boolean;
  pairing: boolean;
  syncing: boolean;
  /** Every OpenCode session Jarvis lists, paused ones included. */
  sessions: JarvisRemote[];
  /** sessionId -> serverId of the imported host. */
  imports: JarvisImports;
  starting: string[];
  error: string | null;
  notice: string | null;
  lastSyncAt: number | null;
}

let state: JarvisState = {
  loaded: false,
  paired: false,
  pairing: false,
  syncing: false,
  sessions: [],
  imports: {},
  starting: [],
  error: null,
  notice: null,
  lastSyncAt: null,
};
let token: DeviceToken | null = null;
const listeners = new Set<() => void>();
let syncTail: Promise<void> = Promise.resolve();
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let booted = false;

function setState(patch: Partial<JarvisState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useJarvisState(): JarvisState {
  return useSyncExternalStore(subscribe, () => state);
}

// A test run passes a token as launch arguments (`-jarvisE2EClientId … -jarvisE2EClientSecret …`,
// which iOS puts in NSUserDefaults); it is used for this launch only and never saved.
function launchArgumentToken(): DeviceToken | null {
  const clientId = Settings.get("jarvisE2EClientId");
  const clientSecret = Settings.get("jarvisE2EClientSecret");
  if (typeof clientId !== "string" || typeof clientSecret !== "string") return null;
  if (!clientId || !clientSecret) return null;
  return { id: "e2e", clientId, clientSecret, pairedAt: 0 };
}

async function loadToken(): Promise<DeviceToken | null> {
  const fromArgs = launchArgumentToken();
  if (fromArgs) return fromArgs;
  const raw = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DeviceToken;
  } catch {
    return null;
  }
}

async function loadImports(): Promise<JarvisImports> {
  const raw = await AsyncStorage.getItem(IMPORTS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as JarvisImports;
  } catch {
    return {};
  }
}

async function saveImports(imports: JarvisImports): Promise<void> {
  await AsyncStorage.setItem(IMPORTS_KEY, JSON.stringify(imports));
  setState({ imports });
}

/** Loads the saved pairing, then syncs now, on every return to the foreground, and while sessions change. */
export function bootJarvis(): void {
  if (!isJarvisEnabled || booted) return;
  booted = true;
  void (async () => {
    token = await loadToken();
    const imports = await loadImports();
    setState({ loaded: true, paired: token !== null, imports });
    if (token) void syncJarvis();
  })();
  AppState.addEventListener("change", (next) => {
    if (next === "active" && token) void syncJarvis();
  });
}

class RefusedError extends Error {}

async function jarvisFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!jarvisExtra || !token) throw new Error("Not paired with Jarvis");
  const response = await fetch(jarvisExtra.url + path, {
    ...init,
    credentials: "omit",
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      "CF-Access-Client-Id": token.clientId,
      "CF-Access-Client-Secret": token.clientSecret,
      Accept: "application/json",
    },
  });
  if (
    isAccessRefusal({
      finalUrl: response.url || jarvisExtra.url + path,
      status: response.status,
      contentType: response.headers.get("content-type"),
    })
  ) {
    throw new RefusedError("Jarvis refused this device");
  }
  return response;
}

async function forgetDevice(notice: string): Promise<void> {
  token = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  setState({ paired: false, sessions: [], notice, error: null });
}

/** Opens Jarvis's sign-in in the system sheet; Jarvis mints this install's own Access token. */
export async function pairWithJarvis(): Promise<void> {
  if (!jarvisExtra || state.pairing) return;
  setState({ pairing: true, error: null, notice: null });
  try {
    const nonce = Array.from(Crypto.getRandomBytes(24), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const deviceName = Constants.deviceName ?? "iPhone";
    const iosVersion = String(Platform.Version);
    const model = `${Platform.OS === "ios" && Platform.isPad ? "iPad" : "iPhone"} · iOS ${iosVersion}`;
    const query = new URLSearchParams({ state: nonce, name: deviceName, model, app: "paseo" });
    const redirect = `${jarvisExtra.scheme}://paired`;
    const result = await WebBrowser.openAuthSessionAsync(
      `${jarvisExtra.url}/api/devices/pair?${query.toString()}`,
      redirect,
      { preferEphemeralSession: false },
    );
    if (result.type !== "success") {
      setState({ pairing: false });
      return;
    }
    const answer = parsePairRedirect(result.url, nonce);
    if (answer.status === "error") {
      const tooSoon = answer.httpStatus === "429";
      setState({
        pairing: false,
        error: tooSoon
          ? "Jarvis allows one pairing every 30 seconds. Try again shortly."
          : answer.error,
      });
      return;
    }
    token = {
      id: answer.id,
      clientId: answer.clientId,
      clientSecret: answer.clientSecret,
      pairedAt: Date.now(),
    };
    await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(token));
    setState({ pairing: false, paired: true });
    await syncJarvis();
  } catch (error) {
    setState({ pairing: false, error: error instanceof Error ? error.message : String(error) });
  }
}

/** Forgets the pairing and every host it imported. */
export async function unpairJarvis(): Promise<void> {
  const store = getHostRuntimeStore();
  for (const serverId of Object.values(state.imports)) {
    await store.removeHost(serverId).catch(() => undefined);
  }
  await saveImports({});
  await forgetDevice(
    "Unpaired from Jarvis. Remove this device in Jarvis → Settings → Devices too.",
  );
}

/** Lists the OpenCode sessions and brings the imported hosts in line with them. Calls are queued. */
export function syncJarvis(): Promise<void> {
  syncTail = syncTail.then(runSync, runSync);
  return syncTail;
}

async function runSync(): Promise<void> {
  if (!token) return;
  setState({ syncing: true });
  try {
    const response = await jarvisFetch("/api/remotes?harness=opencode");
    if (!response.ok) throw new Error(`Jarvis answered ${response.status}`);
    const body = (await response.json()) as { sessions?: JarvisRemote[] };
    const sessions = body.sessions ?? [];
    await applySync(sessions);
    setState({ sessions, syncing: false, error: null, lastSyncAt: Date.now() });
    scheduleRefresh(sessions);
  } catch (error) {
    if (error instanceof RefusedError) {
      const fresh = token && Date.now() - token.pairedAt < PROPAGATION_GRACE_MS;
      if (fresh) {
        setState({ syncing: false });
        scheduleRefresh(null);
        return;
      }
      setState({ syncing: false });
      await forgetDevice("This device was removed from Jarvis. Pair again to see your sessions.");
      return;
    }
    setState({ syncing: false, error: error instanceof Error ? error.message : String(error) });
  }
}

async function applySync(sessions: JarvisRemote[]): Promise<void> {
  const store = getHostRuntimeStore();
  const hosts = store.getHosts().map((host) => ({ serverId: host.serverId, label: host.label }));
  const plan = planJarvisSync({ remotes: sessions, imports: state.imports, hosts });
  const imports: JarvisImports = { ...state.imports };

  for (const upsert of plan.upserts) {
    try {
      const previous = imports[upsert.sessionId];
      const profile = await store.importTrustedConnectionLink(upsert.pairUrl, upsert.label);
      if (previous && previous !== profile.serverId)
        await store.removeHost(previous).catch(() => undefined);
      imports[upsert.sessionId] = profile.serverId;
      if (profile.label !== upsert.label) await store.renameHost(profile.serverId, upsert.label);
    } catch (error) {
      console.warn("[Jarvis] Could not import session", upsert.sessionId, error);
    }
  }
  for (const rename of plan.renames) {
    await store.renameHost(rename.serverId, rename.label).catch(() => undefined);
  }
  for (const removal of plan.removals) {
    await store.removeHost(removal.serverId).catch(() => undefined);
    delete imports[removal.sessionId];
  }
  await saveImports(imports);
}

function scheduleRefresh(sessions: JarvisRemote[] | null): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  const changing =
    sessions === null ||
    state.starting.length > 0 ||
    sessions.some(
      (s) =>
        (s.state !== "started" && s.state !== "paused") || (s.state === "started" && !s.pairUrl),
    );
  if (!changing) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (AppState.currentState === "active") void syncJarvis();
  }, REFRESH_WHILE_CHANGING_MS);
}

/** Starts a paused session; the sync that follows imports it once its daemon answers. */
export async function startJarvisSession(sessionId: string): Promise<void> {
  if (state.starting.includes(sessionId)) return;
  setState({ starting: [...state.starting, sessionId], error: null });
  try {
    const response = await jarvisFetch(`/api/sessions/${encodeURIComponent(sessionId)}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok && response.status !== 202) {
      const text = await response.text().catch(() => "");
      throw new Error(`Start failed (${response.status})${text ? `: ${text.slice(0, 200)}` : ""}`);
    }
  } catch (error) {
    setState({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    // Keep it marked until Jarvis reports it started (or a minute passes).
    setTimeout(() => {
      setState({ starting: state.starting.filter((id) => id !== sessionId) });
    }, 60_000);
    await syncJarvis();
  }
}

export function sessionServerId(sessionId: string): string | null {
  return state.imports[sessionId] ?? null;
}

export function dismissJarvisNotice(): void {
  setState({ notice: null });
}
