import { createSessionApi } from "../client/create-session-api.js";
import schema from "./schema.js";

export const { getSessionUser, getSession, getUser } = createSessionApi(schema);
