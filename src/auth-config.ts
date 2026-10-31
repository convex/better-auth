import type { JwtOptions } from "better-auth/plugins/jwt";
import type { AuthProvider } from "convex/server";
import type { JSONWebKeySet } from "jose";

type JwksDoc = {
  id: string;
  publicKey: string;
  privateKey: string;
  createdAt: number;
  expiresAt?: number;
  alg?: string;
  crv?: string;
};

export const createPublicJwks = (jwks: JwksDoc[], options?: JwtOptions) => {
  /*
  const now = Date.now();
  const DEFAULT_GRACE_PERIOD = 60 * 60 * 24 * 30;
  const gracePeriod =
    (options?.jwks?.gracePeriod ?? DEFAULT_GRACE_PERIOD) * 1000;

  const keys = jwks.filter((key) => {
    if (!key.expiresAt) {
      return true;
    }
    return new Date(key.expiresAt).getTime() + gracePeriod > now;
  });
  */
  const keys = jwks;

  const keyPairConfig = options?.jwks?.keyPairConfig;
  const defaultCrv = keyPairConfig
    ? "crv" in keyPairConfig
      ? (keyPairConfig as { crv: string }).crv
      : undefined
    : undefined;
  return {
    keys: keys.map((keySet) => {
      return {
        alg: keySet.alg ?? options?.jwks?.keyPairConfig?.alg ?? "EdDSA",
        crv: keySet.crv ?? defaultCrv,
        ...JSON.parse(keySet.publicKey),
        kid: keySet.id,
      };
    }),
  } satisfies JSONWebKeySet as JSONWebKeySet;
};

export const getAuthConfigProvider = (opts?: {
  basePath?: string;
  /**
   * @param jwks - Optional static JWKS to avoid fetching from the database.
   *
   * This should be a stringified document from the Better Auth JWKS table. You
   * can create one in the console.
   *
   * Example:
   * ```bash
   * npx convex run auth:generateJwk | npx convex env set JWKS
   * ```
   *
   * Then use it in your auth config:
   * ```ts
   * export default {
   *   providers: [getAuthConfigProvider({ jwks: process.env.JWKS })],
   * } satisfies AuthConfig;
   * ```
   *
   */
  jwks?: string;
}) => {
  const parsedJwks = opts?.jwks ? JSON.parse(opts.jwks) : undefined;
  return {
    type: "customJwt",
    issuer: `${process.env.CONVEX_SITE_URL}`,
    applicationID: "convex",
    algorithm: "RS256",
    jwks: parsedJwks
      ? `data:text/plain;charset=utf-8;base64,${btoa(JSON.stringify(createPublicJwks(parsedJwks)))}`
      : `${process.env.CONVEX_SITE_URL}${opts?.basePath ?? "/api/auth"}/convex/jwks`,
  } satisfies AuthProvider;
};
