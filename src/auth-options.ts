import type { BetterAuthOptions } from "better-auth/minimal";
import { anonymous } from "better-auth/plugins/anonymous";
import { bearer } from "better-auth/plugins/bearer";
import { emailOTP } from "better-auth/plugins/email-otp";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { jwt } from "better-auth/plugins/jwt";
import { magicLink } from "better-auth/plugins/magic-link";
import { oneTimeToken } from "better-auth/plugins/one-time-token";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { twoFactor } from "better-auth/plugins/two-factor";
import { username } from "better-auth/plugins/username";
import { convex } from "./plugins/convex/index.js";
import { convexAdapter } from "./client/adapter.js";

// This is the config used to generate the schema
export const options = {
  database: convexAdapter({} as any, {} as any),
  rateLimit: {
    storage: "database",
  },
  plugins: [
    twoFactor(),
    anonymous(),
    username(),
    phoneNumber(),
    magicLink({ sendMagicLink: async () => {} }),
    emailOTP({ sendVerificationOTP: async () => {} }),
    genericOAuth({
      config: [
        {
          clientId: "",
          clientSecret: "",
          providerId: "",
        },
      ],
    }),
    bearer(),
    oneTimeToken(),
    jwt(),
    convex({
      authConfig: { providers: [{ applicationID: "convex", domain: "" }] },
    }),
  ],
} as BetterAuthOptions; // assert type to avoid overloading ts compiler
