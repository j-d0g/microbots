"use client";

import { useEffect, useState } from "react";
import type { Snapshot } from "@/lib/types";

export default function Home() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    let active = true;

    void fetch("/api/state")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Could not load Mission Control state.");
        }
        return response.json() as Promise<Snapshot>;
      })
      .then((state) => {
        if (active) {
          setSnapshot(state);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  return (
    <main>
      <h1>Mission Control</h1>
      {snapshot ? (
        <p>
          {snapshot.agents.length} agents · {snapshot.tasks.length} tasks ·{" "}
          {snapshot.feed.length} feed events
        </p>
      ) : (
        <p>Loading snapshot…</p>
      )}
    </main>
  );
}
