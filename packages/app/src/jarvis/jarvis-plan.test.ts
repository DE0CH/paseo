import { describe, expect, it } from "vitest";
import { isAccessRefusal, parsePairRedirect, planJarvisSync, remoteLabel } from "./jarvis-plan";

const OFFER = "https://app.paseo.sh/#offer=abc";

describe("planJarvisSync", () => {
  it("imports started sessions that have a pairing link, named after the title", () => {
    const plan = planJarvisSync({
      remotes: [{ id: "s1", title: "Fix the build", state: "started", pairUrl: OFFER }],
      imports: {},
      hosts: [],
    });
    expect(plan.upserts).toEqual([{ sessionId: "s1", pairUrl: OFFER, label: "Fix the build" }]);
    expect(plan.removals).toEqual([]);
  });

  it("keeps paused sessions' hosts and follows a title change", () => {
    const plan = planJarvisSync({
      remotes: [{ id: "s1", title: "New title", state: "paused", pairUrl: null }],
      imports: { s1: "srv-1" },
      hosts: [{ serverId: "srv-1", label: "Old title" }],
    });
    expect(plan.upserts).toEqual([]);
    expect(plan.removals).toEqual([]);
    expect(plan.renames).toEqual([{ serverId: "srv-1", label: "New title" }]);
  });

  it("removes hosts of sessions Jarvis no longer lists", () => {
    const plan = planJarvisSync({
      remotes: [],
      imports: { gone: "srv-2" },
      hosts: [{ serverId: "srv-2", label: "x" }],
    });
    expect(plan.removals).toEqual([{ sessionId: "gone", serverId: "srv-2" }]);
  });

  it("waits for a started session whose daemon is not up yet", () => {
    const plan = planJarvisSync({
      remotes: [
        { id: "s1", title: "t", state: "started", pairUrl: null, error: "daemon not up yet" },
      ],
      imports: {},
      hosts: [],
    });
    expect(plan.upserts).toEqual([]);
    expect(plan.removals).toEqual([]);
  });

  it("falls back to the session id when there is no title", () => {
    expect(remoteLabel({ id: "8d1406cede0438", title: " " })).toBe("8d1406cede0438");
  });
});

describe("parsePairRedirect", () => {
  it("reads the minted token", () => {
    expect(
      parsePairRedirect(
        "paseo-de0ch://paired?state=n1&id=d1&clientId=c.access&clientSecret=s",
        "n1",
      ),
    ).toEqual({ status: "paired", id: "d1", clientId: "c.access", clientSecret: "s" });
  });

  it("rejects an answer for another request", () => {
    expect(
      parsePairRedirect("paseo-de0ch://paired?state=other&id=d1&clientId=c&clientSecret=s", "n1")
        .status,
    ).toBe("error");
  });

  it("passes Jarvis's error and status through", () => {
    expect(
      parsePairRedirect("paseo-de0ch://paired?state=n1&error=too%20soon&status=429", "n1"),
    ).toEqual({
      status: "error",
      error: "too soon",
      httpStatus: "429",
    });
  });
});

describe("isAccessRefusal", () => {
  it("is a refusal when the request ended on the Access login", () => {
    expect(
      isAccessRefusal({
        finalUrl: "https://deyaochen.cloudflareaccess.com/cdn-cgi/access/login",
        status: 200,
        contentType: "text/html",
      }),
    ).toBe(true);
  });

  it("is a refusal for a non-JSON 403, not for Jarvis's own JSON 403", () => {
    const finalUrl = "https://jarvis.deyaochen.com/api/remotes";
    expect(isAccessRefusal({ finalUrl, status: 403, contentType: "text/html" })).toBe(true);
    expect(isAccessRefusal({ finalUrl, status: 403, contentType: "application/json" })).toBe(false);
    expect(isAccessRefusal({ finalUrl, status: 200, contentType: "application/json" })).toBe(false);
  });
});
