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
  crossDomain: {
    oneTimeToken: {
      verify: (args: { token: string }) => Promise<{
        data?: { session?: { token: string } } | null;
      }>;
    };
  };
  updateSession: () => void;
};

export const handleCrossDomainCallback = async (
  authClient: RequiredAuthClient,
  href: string,
  replaceUrl: (url: URL) => void
) => {
  const url = new URL(href);
  const token = url.searchParams.get("ott");
  if (!token) {
    return;
  }

  url.searchParams.delete("ott");
  replaceUrl(url);
  const crossDomainClient = authClient as AuthClientWithCrossDomain;
  const result = await crossDomainClient.crossDomain.oneTimeToken.verify({
    token,
  });
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
  crossDomainClient.updateSession();
};
