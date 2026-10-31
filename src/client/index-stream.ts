import type { Value } from "convex/values";

export const fieldValue = (doc: any, field: string): Value | undefined =>
  field
    .split(".")
    .reduce(
      (value, part) =>
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.prototype.hasOwnProperty.call(value, part)
          ? value[part]
          : undefined,
      doc
    );
