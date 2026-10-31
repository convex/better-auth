import { afterEach, describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import { runAtomicMutation } from "./atomic-retry.js";
import { convexAdapter } from "./adapter.js";
import { api } from "../component/_generated/api.js";
import type { GenericCtx } from "../utils/index.js";

const message =
  'Documents read from or written to the "mapped" table changed while this mutation was being run and on every subsequent retry. Another call to this mutation changed the document with ID "j97b4gtzt49dpkkna1v8yzbkx18gygkj". See https://docs.convex.dev/error#1';
const conflict = () => new Error(message);
const action = { runAction: vi.fn() } as unknown as GenericCtx;
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("atomic mutation conflict retries", () => {
  it("retries confirmed aborted transactions with jitter and returns only the successful result", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const run = vi
      .fn()
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockResolvedValue({ count: 1 });
    const result = runAtomicMutation(action, run);
    const assertion = expect(result).resolves.toEqual({ count: 1 });
    await vi.advanceTimersByTimeAsync(49);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(99);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("stops after five attempts and preserves the last conflict", async () => {
    vi.useFakeTimers();
    const failures = Array.from({ length: 5 }, conflict);
    const run = vi
      .fn()
      .mockImplementation(() =>
        Promise.reject(failures[run.mock.calls.length - 1])
      );
    const assertion = expect(runAtomicMutation(action, run)).rejects.toBe(
      failures[4]
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(run).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    new Error("fetch failed"),
    new Error("Request timed out after the mutation may have committed"),
    new Error("TooManyRequests"),
    new Error(`Uncaught Error: ${message}\n    at handler (fixture.ts:1:1)`),
    new ConvexError(message),
    Object.assign(new Error(message), { data: undefined }),
    new Error(
      message.replace("https://docs.convex.dev/error#1", "https://example.com")
    ),
    new Error(message + " extra details"),
    new Error(message + "\n"),
    message,
  ])(
    "does not retry ambiguous, application, or unrecognized errors (%#)",
    async (error) => {
      const run = vi.fn().mockRejectedValue(error);
      await expect(runAtomicMutation(action, run)).rejects.toBe(error);
      expect(run).toHaveBeenCalledTimes(1);
    }
  );

  it("accepts the server's named-conflicting-mutation variant", async () => {
    vi.useFakeTimers();
    const error = new Error(
      message.replace(
        "Another call to this mutation",
        'A call to the mutation "other:write"'
      )
    );
    const run = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(null);
    const assertion = expect(
      runAtomicMutation(action, run)
    ).resolves.toBeNull();
    await vi.runAllTimersAsync();
    await assertion;
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each([
    { db: {}, runMutation: vi.fn() },
    { db: {}, runAction: vi.fn() },
    {},
  ])("never retries inside a mutation/query context (%#)", async (ctx) => {
    const error = conflict();
    const run = vi.fn().mockRejectedValue(error);
    await expect(
      runAtomicMutation(ctx as unknown as GenericCtx, run)
    ).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([null, { count: 1 }])(
    "does not repeat a successful result (%#)",
    async (value) => {
      const run = vi.fn().mockResolvedValue(value);
      await expect(runAtomicMutation(action, run)).resolves.toBe(value);
      expect(run).toHaveBeenCalledTimes(1);
    }
  );

  it.each(["incrementOne", "consumeOne"] as const)(
    "wires %s to retries without rerunning the caller",
    async (method) => {
      vi.useFakeTimers();
      const runMutation = vi
        .fn()
        .mockRejectedValueOnce(conflict())
        .mockResolvedValue({
          _id: "user-id",
          name: "Alice",
          email: "alice@example.com",
          image: "claimed",
        });
      const ctx = {
        runAction: vi.fn(),
        runMutation,
        runQuery: vi.fn(),
      } as unknown as GenericCtx;
      const adapter = convexAdapter(ctx, { adapter: api.adapter } as any)({});
      const where = [{ field: "id", value: "user-id" }];
      const result =
        method === "incrementOne"
          ? adapter.incrementOne({
              model: "user",
              where,
              increment: {},
              set: { image: "claimed" },
            })
          : adapter.consumeOne({ model: "user", where });
      const assertion = expect(result).resolves.toMatchObject({
        id: "user-id",
        image: "claimed",
      });
      await Promise.all([vi.runAllTimersAsync(), assertion]);
      expect(runMutation).toHaveBeenCalledTimes(2);
      expect(runMutation.mock.calls[1]).toEqual(runMutation.mock.calls[0]);
    }
  );
});

it("does not retry an ambiguous failure after a confirmed conflict", async () => {
  vi.useFakeTimers();
  let committed = 0;
  const uncertain = new Error("Network response lost after commit");
  const run = vi
    .fn()
    .mockRejectedValueOnce(conflict())
    .mockImplementation(async () => {
      committed++;
      throw uncertain;
    });
  const assertion = expect(runAtomicMutation(action, run)).rejects.toBe(
    uncertain
  );
  await vi.runAllTimersAsync();
  await assertion;
  expect(run).toHaveBeenCalledTimes(2);
  expect(committed).toBe(1);
});
