import { afterEach, describe, expect, it, vi } from "vitest";
import { convexBetterAuthNextJs } from "./index.js";

const SITE_URL = "https://test.convex.site";
const CONVEX_URL = "https://test.convex.cloud";

const setup = () => {
  const { handler } = convexBetterAuthNextJs({
    convexUrl: CONVEX_URL,
    convexSiteUrl: SITE_URL,
  });
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response());
  return { handler, fetchSpy };
};

const initOf = (spy: ReturnType<typeof vi.spyOn>): RequestInit =>
  (spy.mock.calls[0]?.[1] as RequestInit) ?? {};

const headersOf = (spy: ReturnType<typeof vi.spyOn>): Headers =>
  new Headers(initOf(spy).headers);

describe("convexBetterAuthNextJs handler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("strips hop-by-hop headers from the forwarded request", async () => {
    const { handler, fetchSpy } = setup();
    const request = new Request(
      "https://app.example.com/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "transfer-encoding": "chunked",
          "content-length": "42",
          connection: "keep-alive",
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "test@example.com" }),
      }
    );
    await handler.POST(request);
    const headers = headersOf(fetchSpy);
    expect(headers.get("transfer-encoding")).toBeNull();
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("connection")).toBeNull();
  });

  it("forwards to upstream URL preserving path and query", async () => {
    const { handler, fetchSpy } = setup();
    const request = new Request(
      "https://app.example.com/api/auth/sign-in/email?foo=bar",
      { method: "POST", body: "{}" }
    );
    await handler.POST(request);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      `${SITE_URL}/api/auth/sign-in/email?foo=bar`
    );
  });

  it("sets host and forwarding headers", async () => {
    const { handler, fetchSpy } = setup();
    const request = new Request(
      "https://app.example.com/api/auth/sign-in/email",
      { method: "POST", body: "{}" }
    );
    await handler.POST(request);
    const headers = headersOf(fetchSpy);
    expect(headers.get("host")).toBe(new URL(SITE_URL).host);
    expect(headers.get("x-forwarded-host")).toBeNull();
    expect(headers.get("x-forwarded-proto")).toBeNull();
    expect(headers.get("x-better-auth-forwarded-host")).toBe("app.example.com");
    expect(headers.get("x-better-auth-forwarded-proto")).toBe("https");
  });

  it("buffers POST body and forwards as ArrayBuffer", async () => {
    const { handler, fetchSpy } = setup();
    const body = JSON.stringify({ email: "test@example.com" });
    const request = new Request(
      "https://app.example.com/api/auth/sign-in/email",
      { method: "POST", body }
    );
    await handler.POST(request);
    const init = initOf(fetchSpy);
    expect(init.body).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(body);
  });

  it("does not set body for GET requests", async () => {
    const { handler, fetchSpy } = setup();
    const request = new Request(
      "https://app.example.com/api/auth/get-session",
      { method: "GET" }
    );
    await handler.GET(request);
    expect(initOf(fetchSpy).body).toBeUndefined();
  });

  it("does not set body for empty POST", async () => {
    const { handler, fetchSpy } = setup();
    const request = new Request("https://app.example.com/api/auth/sign-out", {
      method: "POST",
    });
    await handler.POST(request);
    expect(initOf(fetchSpy).body).toBeUndefined();
  });
});
