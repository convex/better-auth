// @vitest-environment node

import { afterEach, expect, test, vi } from "vitest";
import {
  getSessionIdFromToken,
  hasTokenClaims,
} from "./provider-auth-utils.js";

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const payload = encode({ sessionId: "会话_🙂", exp: 2_000_000_000 });
const token = `header.${payload}.signature`;
const invalidUtf8 = Buffer.from([0xc3, 0x28]).toString("base64url");

afterEach(() => {
  vi.unstubAllGlobals();
});

test.each([false, true])(
  "decodes UTF-8 claims without browser or Node decoding globals (padded: %s)",
  (padded) => {
    vi.stubGlobal("atob", undefined);
    vi.stubGlobal("TextDecoder", undefined);
    vi.stubGlobal("Buffer", undefined);
    const encoded = padded
      ? payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")
      : payload;
    const value = `header.${encoded}.signature`;
    const accepted = hasTokenClaims(value);
    const sessionId = getSessionIdFromToken(value);
    vi.unstubAllGlobals();
    expect(accepted).toBe(true);
    expect(sessionId).toBe("会话_🙂");
  }
);

test("decodes UTF-8 claims with browser decoding globals present", () => {
  expect(hasTokenClaims(token)).toBe(true);
  expect(getSessionIdFromToken(token)).toBe("会话_🙂");
});

test.each([
  undefined,
  null,
  12,
  "",
  "header.signature",
  "header.!.signature",
  "header.a.signature",
  `header.${payload}=invalid.signature`,
  `header.${payload}===.signature`,
  `header.${invalidUtf8}.signature`,
  `header.${encode(null)}.signature`,
  `header.${encode({ sessionId: 1, exp: 2_000_000_000 })}.signature`,
])("rejects malformed token metadata without atob (%j)", (value) => {
  vi.stubGlobal("atob", undefined);
  expect(hasTokenClaims(value)).toBe(false);
  expect(getSessionIdFromToken(value)).toBeNull();
});

test("keeps session identity extraction separate from expiry claim validation", () => {
  vi.stubGlobal("atob", undefined);
  const value = `header.${encode({ sessionId: "session_1", exp: "later" })}.signature`;
  expect(hasTokenClaims(value)).toBe(false);
  expect(getSessionIdFromToken(value)).toBe("session_1");
});
