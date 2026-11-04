import { describe, expect, it } from "vitest";
import type { AuthConfig } from "convex/server";
import { convex } from "./index.js";

const authConfig = {
  providers: [{ applicationID: "convex", domain: "https://example.com" }],
} satisfies AuthConfig;

const getJwtSetCookieMatcher = () => {
  const plugin = convex({ authConfig });
  const afterHooks = plugin.hooks?.after ?? [];
  const matcher = afterHooks.find((hook) => {
    return (
      hook.matcher({
        path: "/update-session",
        context: { session: { id: "s1" } },
      } as unknown as Parameters<typeof hook.matcher>[0]) &&
      !hook.matcher({
        path: "/sign-out",
        context: { session: null },
      } as unknown as Parameters<typeof hook.matcher>[0])
    );
  })?.matcher;
  if (!matcher) {
    throw new Error("Failed to find Convex JWT set-cookie after hook matcher");
  }
  return matcher;
};

describe("convex plugin JWT cookie refresh matcher", () => {
  it("matches update-session", () => {
    const matcher = getJwtSetCookieMatcher();
    type MatcherContext = Parameters<typeof matcher>[0];
    const ctx = {
      path: "/update-session",
      context: { session: { id: "s1" } },
    };
    expect(matcher(ctx as unknown as MatcherContext)).toBe(true);
  });

  it("matches get-session only when a session exists", () => {
    const matcher = getJwtSetCookieMatcher();
    type MatcherContext = Parameters<typeof matcher>[0];
    const withSessionCtx = {
      path: "/get-session",
      context: { session: { id: "s1" } },
    };
    const withoutSessionCtx = {
      path: "/get-session",
      context: { session: null },
    };
    expect(matcher(withSessionCtx as unknown as MatcherContext)).toBe(true);
    expect(matcher(withoutSessionCtx as unknown as MatcherContext)).toBe(false);
  });

  it("never matches requests that create a new session", () => {
    const matcher = getJwtSetCookieMatcher();
    type MatcherContext = Parameters<typeof matcher>[0];
    for (const path of [
      "/sign-in/email",
      "/sign-in/username",
      "/sign-in/phone-number",
      "/sign-in/social",
      "/sign-up/email",
      "/callback/github",
      "/magic-link/verify",
      "/email-otp/verify-email",
      "/phone-number/verify",
      "/siwe/verify",
    ]) {
      const ctx = {
        path,
        context: { session: null, newSession: { session: { id: "s1" } } },
      };
      expect(matcher(ctx as unknown as MatcherContext), path).toBe(false);
    }
  });
});
