import { createApi } from "../../client/index.js";
import { additionalFieldsProfileOptions } from "./auth-options.profile-additional-fields.js";
import schema from "./schema.profile-additional-fields.js";

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
} = createApi(schema, () => additionalFieldsProfileOptions);
