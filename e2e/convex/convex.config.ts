import { defineApp } from "convex/server";
import oauthProvider from "./betterAuth/convex.config";

import audit from "./auditComponent/convex.config";
const app = defineApp();
app.use(oauthProvider, { name: "oauthProvider" });
app.use(audit, { name: "audit" });
export default app;
