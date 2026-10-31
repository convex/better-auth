import { defineSchema } from "convex/server";
import { tables } from "./generatedSchema";
export { tables };
export default defineSchema(tables);
