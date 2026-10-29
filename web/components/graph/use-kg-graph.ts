"use client";

import { useCallback, useEffect, useState } from "react";
import * as backend from "@/lib/api/backend";
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
  const refresh = useCallback(() => setRefreshTick((tick) => tick + 1), []);

  useEffect(() => {
    if (!userId) {
      setGraph({ nodes: [], links: [] });
      setLoadError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    let rejectedCount = 0;
    const total = composioConfigured ? 7 : 6;
    const connections = composioConfigured
      ? backend.getConnections(userId).catch(() => {
          rejectedCount++;
          return [];
        })
      : Promise.resolve([]);
    Promise.all([
      backend.getKgUser(userId).catch(() => {
        rejectedCount++;
        return null;
      }),
      backend.getKgIntegrations(userId).catch(() => {
        rejectedCount++;
        return [];
      }),
      backend.getKgEntities(undefined, userId).catch(() => {
        rejectedCount++;
        return [];
      }),
      backend.getKgMemories({ by: "confidence", limit: 30 }, userId).catch(() => {
        rejectedCount++;
        return [];
      }),
      backend.getKgSkills({ minStrength: 1 }, userId).catch(() => {
        rejectedCount++;
        return [];
      }),
      backend.getKgWorkflows(userId).catch(() => {
        rejectedCount++;
        return [];
      }),
      connections,
    ])
      .then(
        ([user, integrations, entities, memories, skills, workflows, connections]) => {
          if (cancelled) return;
          if (rejectedCount === total) {
            setLoadError("backend offline — your data is safe, retry in a moment.");
            return;
          }
          setGraph(
            toGraph({
              user,
              integrations,
              entities,
              memories,
              skills,
              workflows,
              connections,
            }),
          );
        },
      )
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "load failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, composioConfigured, refreshTick]);

  return { graph, loading, loadError, refresh };
}
