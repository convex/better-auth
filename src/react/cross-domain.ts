import { crossDomainCapability } from "../plugins/cross-domain/client.js";

export type RequiredAuthClient = {
  useSession: () => {
    data: { session?: { id: string } } | null;
    isPending: boolean;
  };
  getSession: (args?: {
    fetchOptions: { headers: Record<string, string> };
  }) => Promise<unknown>;
  convex: {
    token: (args: {
      fetchOptions: { throw: boolean };
    }) => Promise<{ data?: { token?: string } | null }>;
  };
};

type AuthClientWithCrossDomain = RequiredAuthClient & {
  crossDomainCapability: typeof crossDomainCapability;
  crossDomain: {
    oneTimeToken: {
      verify: (args: { token: string }) => Promise<{
        data?: { session?: { token: string } } | null;
      }>;
    };
  };
  updateSession: () => void;
};

const hasCrossDomain = (
  authClient: RequiredAuthClient
): authClient is AuthClientWithCrossDomain => {
  const candidate = authClient as Partial<AuthClientWithCrossDomain>;
  return (
    candidate.crossDomainCapability === crossDomainCapability &&
    typeof candidate.crossDomain?.oneTimeToken?.verify === "function" &&
    typeof candidate.updateSession === "function"
  );
};

export const handleCrossDomainCallback = async (
  authClient: RequiredAuthClient,
  href: string,
  replaceUrl: (url: URL) => void
) => {
  const url = new URL(href);
  const token = url.searchParams.get("ott");
  if (!token || !hasCrossDomain(authClient)) {
    return;
  }

  url.searchParams.delete("ott");
  replaceUrl(url);
  const result = await authClient.crossDomain.oneTimeToken.verify({ token });
  const session = result.data?.session;
  if (!session) {
    return;
  }
  await authClient.getSession({
    fetchOptions: {
      headers: {
        Authorization: `Bearer ${session.token}`,
      },
    },
  });
  authClient.updateSession();
};
