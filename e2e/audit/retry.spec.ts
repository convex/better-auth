import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const client = new ConvexHttpClient("http://127.0.0.1:3210");

test("40 concurrent atomic writes preserve one trigger effect per commit without caller retries", async () => {
  const result = await client.action(api.audit.retryStress, { count: 40 });
  console.log(
    `Atomic retry stress: ${result.attempts} attempts, ${result.conflicts} server conflicts`
  );
  expect(result.errors).toEqual([]);
  expect(result.successes).toBe(40);
  expect(result.count).toBe(40);
  expect(result.triggerCount).toBe(40);
  expect(result.attempts).toBe(40 + result.conflicts);
});

test("a trigger's conflict-shaped application error is not retried", async () => {
  const result = await client.action(api.audit.retryStress, {
    count: 1,
    spoof: true,
  });
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain("Uncaught Error:");
  expect(result.attempts).toBe(1);
  expect(result.count).toBe(0);
  expect(result.triggerCount).toBe(0);
});
