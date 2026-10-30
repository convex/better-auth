import { createApi } from "../../client/index.js";
import { pluginTableProfileOptions } from "./auth-options.profile-plugin-table.js";
import schema from "./schema.profile-plugin-table.js";

export const {
  create,
  findOne,
  findMany,
  updateOne,
  updateMany,
  deleteOne,
  deleteMany,
  consumeOne,
  incrementOne,
} = createApi(schema, () => pluginTableProfileOptions);
