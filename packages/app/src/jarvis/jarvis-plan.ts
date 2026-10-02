// Pure part of the Jarvis sync: given what Jarvis lists and what the app has
// imported before, decide which hosts to add, rename and remove. Kept free of
// React Native imports so it runs under vitest as-is.

export type JarvisSessionState = "started" | "paused" | string;

export interface JarvisRemote {
  id: string;
  title: string | null;
  state: JarvisSessionState;
  model?: string | null;
  pairUrl?: string | null;
  error?: string | null;
}

/** sessionId -> serverId of the host the app imported for that session. */
export type JarvisImports = Record<string, string>;

export interface JarvisHostRef {
  serverId: string;
  label: string;
}

export interface JarvisSyncPlan {
  /** Started sessions with a pairing link: import (or refresh) the host. */
  upserts: { sessionId: string; pairUrl: string; label: string }[];
  /** Hosts whose Jarvis title changed. */
  renames: { serverId: string; label: string }[];
  /** Hosts of sessions Jarvis no longer lists (destroyed). */
  removals: { sessionId: string; serverId: string }[];
}

export function remoteLabel(remote: Pick<JarvisRemote, "id" | "title">): string {
  const title = remote.title?.trim();
  return title ? title : remote.id;
}

export function planJarvisSync(input: {
  remotes: JarvisRemote[];
  imports: JarvisImports;
  hosts: JarvisHostRef[];
}): JarvisSyncPlan {
  const listed = new Set(input.remotes.map((remote) => remote.id));
  const hostsById = new Map(input.hosts.map((host) => [host.serverId, host]));
  const plan: JarvisSyncPlan = { upserts: [], renames: [], removals: [] };

  for (const remote of input.remotes) {
    const label = remoteLabel(remote);
    const importedServerId = input.imports[remote.id];
    const host = importedServerId ? hostsById.get(importedServerId) : undefined;
    if (remote.state === "started" && remote.pairUrl) {
      // Always re-import a started session: the offer may carry a new key or
      // relay, and the host may have been removed by hand.
      plan.upserts.push({ sessionId: remote.id, pairUrl: remote.pairUrl, label });
      continue;
    }
    if (host && host.label !== label) {
      plan.renames.push({ serverId: host.serverId, label });
    }
  }

  for (const [sessionId, serverId] of Object.entries(input.imports)) {
    if (!listed.has(sessionId)) plan.removals.push({ sessionId, serverId });
  }
  return plan;
}

export type JarvisPairResult =
  | { status: "paired"; id: string; clientId: string; clientSecret: string }
  | { status: "error"; error: string; httpStatus: string | null };

/** Parses `paseo-de0ch://paired?state=…&id=…&clientId=…&clientSecret=…`. */
export function parsePairRedirect(url: string, expectedState: string): JarvisPairResult {
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1).split("#")[0] : "";
  const params = new URLSearchParams(query);
  if (params.get("state") !== expectedState) {
    return {
      status: "error",
      error: "The sign-in answer did not match this request.",
      httpStatus: null,
    };
  }
  const error = params.get("error");
  if (error) return { status: "error", error, httpStatus: params.get("status") };
  const id = params.get("id");
  const clientId = params.get("clientId");
  const clientSecret = params.get("clientSecret");
  if (!id || !clientId || !clientSecret) {
    return { status: "error", error: "Jarvis sent an incomplete answer.", httpStatus: null };
  }
  return { status: "paired", id, clientId, clientSecret };
}

/**
 * Cloudflare Access refused the device token: the request ended on the Access
 * login, or Jarvis answered 401/403 with something that is not JSON.
 */
export function isAccessRefusal(input: {
  finalUrl: string;
  status: number;
  contentType: string | null;
}): boolean {
  if (/(^|\.)cloudflareaccess\.com/.test(hostOf(input.finalUrl))) return true;
  if (input.status !== 401 && input.status !== 403) return false;
  return !(input.contentType ?? "").includes("application/json");
}

function hostOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url);
  return match ? match[1].toLowerCase() : "";
}
