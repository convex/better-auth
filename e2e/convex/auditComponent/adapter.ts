import { createApi } from "@convex-dev/better-auth";
import schema from "./schema";
import { options } from "./options";
export const {
  create,
  findOne,
  findMany,
  updateOne,
  incrementOne,
  updateMany,
  deleteOne,
  deleteMany,
} = createApi(schema, () => options);
