import type { GenericDataModel } from "convex/server";
import { isActionCtx } from "../utils/index.js";
import type { GenericCtx } from "../utils/index.js";

// Convex 1.46 exposes exhausted OCC retries as an Error without a structured
// code. Match the complete server message, not a substring from user code or
// a nested action. Unknown formats deliberately fail closed.
const exhaustedConflict =
  /^Documents read from or written to the "[^"\r\n]+" table changed while this mutation was being run and on every subsequent retry\. (?:Another call to this mutation|A call to the mutation "[^"\r\n]+") changed the document with ID "[^"\r\n]+"\. See https:\/\/docs\.convex\.dev\/error#1$/;

export async function runAtomicMutation<T, DataModel extends GenericDataModel>(
  ctx: GenericCtx<DataModel>,
  run: () => Promise<T>
): Promise<T> {
  // Nested mutations share their caller's transaction. Only actions can start
  // a fresh transaction and use nondeterministic timers/backoff safely.
  if (!isActionCtx(ctx) || "db" in ctx) return run();

  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (
        attempt === 4 ||
        !(error instanceof Error) ||
        error.name !== "Error" ||
        "data" in error ||
        /[\r\n]/.test(error.message) ||
        !exhaustedConflict.test(error.message)
      ) {
        throw error;
      }
      // Four retries, each delayed by 50–100% of 100/200/400/800ms.
      // Retry only the rejected transaction, never its surrounding auth flow.
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.ceil(100 * 2 ** attempt * (0.5 + Math.random() / 2))
        )
      );
    }
  }
}
