"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { connectAgentStream } from "@/lib/agent-client";
import { useAgentStore, type RoomName } from "@/lib/store";

const ROOM_FROM_PATH: Record<string, RoomName> = {
  "/brief": "brief",
  "/graph": "graph",
  "/workflow": "workflow",
  "/stack": "stack",
  "/waffle": "waffle",
  "/playbooks": "playbooks",
  "/settings": "settings",
};

/** Mounts once in the shell. Opens the SSE agent stream and syncs
 *  route ↔ store.room so agent-emitted ui.room events drive navigation. */
export function AgentBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const room = useAgentStore((s) => s.room);
  const roomSlug = useAgentStore((s) => s.roomSlug);
  const setRoom = useAgentStore((s) => s.setRoom);
  const setRoomSlug = useAgentStore((s) => s.setRoomSlug);

  // Sync URL -> store on route change.
  useEffect(() => {
    const parts = pathname?.split("/").filter(Boolean) ?? [];
    const base = "/" + (parts[0] ?? "");
    const mapped = ROOM_FROM_PATH[base];
    if (mapped && mapped !== room) setRoom(mapped);
    const slug = parts[1] ?? null;
    if (slug !== roomSlug) setRoomSlug(slug);
  }, [pathname, room, roomSlug, setRoom, setRoomSlug]);

  // Sync store -> URL when agent changes room/slug.
  useEffect(() => {
    const target = roomSlug ? `/${room}/${roomSlug}` : `/${room}`;
    if (pathname !== target) {
      router.push(target as "/brief");
    }
  }, [room, roomSlug, pathname, router]);

  // Open SSE stream for the lifetime of the shell.
  useEffect(() => {
    const ctrl = new AbortController();
    connectAgentStream(ctrl.signal).catch(() => {
      /* stream will be retried by the server as needed */
    });
    return () => ctrl.abort();
  }, []);

  return null;
}
