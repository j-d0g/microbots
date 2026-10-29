"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as backend from "@/lib/api/backend";
import { BASE_URL } from "@/lib/api/backend";
import { fetchKgResource } from "@/lib/use-kg-resource";
import { toGraph } from "@/lib/api/kg-to-graph";
import type { GraphLink, GraphNode } from "./types";

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export function useKgGraph(
  userId: string | null,
  composioConfigured: boolean,
) {
  const [graph, setGraph] = useState<GraphData>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const bypassCacheRef = useRef(false);
  const refresh = useCallback(() => {
    bypassCacheRef.current = true;
    setRefreshTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    if (!userId) {
      setGraph({ nodes: [], links: [] });
      setLoadError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const bypassCache = bypassCacheRef.current;
    bypassCacheRef.current = false;
    setLoading(true);
    setLoadError(null);
    let rejectedCount = 0;
    const total = composioConfigured ? 7 : 6;
    const source = {
      user: null as Awaited<ReturnType<typeof backend.getKgUser>> | null,
      integrations: [] as Awaited<ReturnType<typeof backend.getKgIntegrations>>,
      entities: [] as Awaited<ReturnType<typeof backend.getKgEntities>>,
      memories: [] as Awaited<ReturnType<typeof backend.getKgMemories>>,
      skills: [] as Awaited<ReturnType<typeof backend.getKgSkills>>,
      workflows: [] as Awaited<ReturnType<typeof backend.getKgWorkflows>>,
      connections: [] as Awaited<ReturnType<typeof backend.getConnections>>,
    };
    const publish = () => {
      if (!cancelled) setGraph(toGraph(source));
    };
    const load = async <K extends keyof typeof source>(
      key: K,
      path: string,
      fetcher: (signal: AbortSignal) => Promise<(typeof source)[K]>,
    ) => {
      try {
        source[key] = await fetchKgResource(
          new URL(path, BASE_URL).href,
          fetcher,
          bypassCache,
        );
        publish();
      } catch {
        rejectedCount += 1;
      }
    };
    const requests = [
      load("user", "/api/kg/user", () => backend.getKgUser(userId)),
      load("integrations", "/api/kg/integrations", (signal) =>
        backend.getKgIntegrations(userId, signal),
      ),
      load("entities", "/api/kg/entities", (signal) =>
        backend.getKgEntities(undefined, userId, signal),
      ),
      load("memories", "/api/kg/memories?by=confidence&limit=30", (signal) =>
        backend.getKgMemories({ by: "confidence", limit: 30 }, userId, signal),
      ),
      load("skills", "/api/kg/skills?min_strength=1", (signal) =>
        backend.getKgSkills({ minStrength: 1 }, userId, signal),
      ),
      load("workflows", "/api/kg/workflows", (signal) =>
        backend.getKgWorkflows(userId, signal),
      ),
      composioConfigured
        ? load("connections", "/api/composio/connections", () =>
            backend.getConnections(userId),
          )
        : Promise.resolve(),
    ];
    void Promise.all(requests).then(() => {
      if (cancelled) return;
      if (rejectedCount === total) {
        setLoadError("backend offline — retry in a moment.");
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, composioConfigured, refreshTick]);

  return { graph, loading, loadError, refresh };
}
