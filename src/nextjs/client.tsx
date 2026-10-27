import { useConvexAuth, useQuery } from "convex/react";
import type { Preloaded } from "convex/react";
import { makeFunctionReference } from "convex/server";
import type { FunctionReference } from "convex/server";
import { jsonToConvex } from "convex/values";
import { useEffect, useMemo, useState } from "react";

const useConvexPreloadedQuery = <Query extends FunctionReference<"query">>(
  preloadedQuery: Preloaded<Query>,
  { requireAuth = true }: { requireAuth?: boolean } = {}
): Query["_returnType"] | undefined => {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const [preloadExpired, setPreloadExpired] = useState(false);
  useEffect(() => {
    if (requireAuth && !isLoading && !isAuthenticated) {
      setPreloadExpired(true);
    }
  }, [requireAuth, isLoading, isAuthenticated]);
  const args = useMemo(
    () => jsonToConvex(preloadedQuery._argsJSON),
    [preloadedQuery._argsJSON]
  ) as Query["_args"];
  const preloadedResult = useMemo(
    () => jsonToConvex(preloadedQuery._valueJSON),
    [preloadedQuery._valueJSON]
  );
  const result = useQuery(
    makeFunctionReference(preloadedQuery._name) as Query,
    requireAuth && !isAuthenticated ? ("skip" as const) : args
  );
  useEffect(() => {
    if (result !== undefined) {
      setPreloadExpired(true);
    }
  }, [result]);
  if (requireAuth) {
    return preloadExpired ? result : preloadedResult;
  }
  return result === undefined ? preloadedResult : result;
};

export const usePreloadedAuthQuery = <Query extends FunctionReference<"query">>(
  preloadedQuery: Preloaded<Query>
  // `undefined` once the preloaded value expires with no live result to
  // replace it, eg. when auth settles as unauthenticated. Same as `useQuery`.
): Query["_returnType"] | undefined => {
  const { isLoading } = useConvexAuth();
  const latestData = useConvexPreloadedQuery(preloadedQuery);
  const [data, setData] = useState(latestData);
  useEffect(() => {
    if (!isLoading) {
      setData(latestData);
    }
  }, [latestData, isLoading]);
  return data;
};
