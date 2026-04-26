"use client";

/**
 * wiki window — two-pane tree + page viewer/editor.
 *
 * Backed by `GET /api/kg/wiki` (tree) and `GET /api/kg/wiki/{path}`
 * (selected page). Edit toggle posts `PUT /api/kg/wiki/{path}` with
 * the rationale field — server no-ops on unchanged content.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentStore } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import {
  getWiki,
  getWikiPage,
  writeWikiPage,
  type WikiNode,
  type WikiPage,
} from "@/lib/kg-client";
import { registerTools } from "@/lib/room-tools";
import { KgShell, KgHeader } from "./kg-shell";
import { cn } from "@/lib/cn";

export function WikiWindow({
  payload,
}: {
  payload?: Record<string, unknown>;
}) {
  const userId = useAgentStore((s) => s.userId);

  const [path, setPath] = useState<string | null>(
    (payload?.path as string) ?? null,
  );
  const [editing, setEditing] = useState(false);

  const seedTree = (payload?.tree as WikiNode[] | undefined) ?? null;
  const seedPage = (payload?.page as WikiPage | undefined) ?? null;

  const treeFetcher = useCallback(
    (signal: AbortSignal) => getWiki(userId, signal),
    [userId],
  );
  const pageFetcher = useCallback(
    (signal: AbortSignal) =>
      path
        ? getWikiPage(path, userId, signal)
        : Promise.resolve(null as unknown as WikiPage),
    [path, userId],
  );
  const tree = useKgResource(treeFetcher, seedTree);
  const page = useKgResource(pageFetcher, seedPage);

  /* Register UI handlers for the orchestrator's `wiki_*` tools.
   * Navigation tools (`navigate_to`, `go_to_index`, `go_to_parent`)
   * mutate `path`; mutating tools (`save_page`, `delete_page`,
   * `revert_to_revision`) refetch on this side after the
   * orchestrator's API call. */
  useEffect(() => {
    return registerTools("wiki", [
      {
        name: "navigate_to",
        description: "Open a wiki page by path.",
        args: { path: "string" },
        run: (args) => {
          if (typeof args.path === "string" && args.path) {
            setPath(args.path);
            setEditing(false);
          }
        },
      },
      {
        name: "go_to_index",
        description: "Return to the wiki index (clear selection).",
        run: () => {
          setPath(null);
          setEditing(false);
        },
      },
      {
        name: "go_to_parent",
        description: "Move up one segment in the current path.",
        run: () => {
          if (!path) return;
          const parts = path.split("/").filter(Boolean);
          if (parts.length <= 1) {
            setPath(null);
          } else {
            setPath(parts.slice(0, -1).join("/"));
          }
          setEditing(false);
        },
      },
      {
        name: "search",
        description: "Narration hook — agent narrates matches aloud.",
        run: () => {
          /* No in-window search yet; agent narration is the artefact. */
        },
      },
      {
        name: "list_children",
        description: "Narration hook — children are visible in the tree pane.",
        run: () => {
          /* Tree already rendered; pure read. */
        },
      },
      {
        name: "read_page",
        description: "Narration hook — page already rendered in detail pane.",
        run: () => {
          /* Pure read. */
        },
      },
      {
        name: "edit_page",
        description: "Toggle the editor for the current page.",
        run: () => {
          if (path) setEditing(true);
        },
      },
      {
        name: "cancel_edit",
        description: "Exit the editor without saving.",
        run: () => setEditing(false),
      },
      {
        name: "save_page",
        description: "Refetch tree + page after a save.",
        run: () => {
          setEditing(false);
          tree.refetch();
          page.refetch();
        },
      },
      {
        name: "new_page",
        description: "Open the editor for a new page (path stays null).",
        run: () => {
          setPath(null);
          setEditing(true);
        },
      },
      {
        name: "delete_page",
        description: "Refetch after a delete.",
        run: () => {
          setPath(null);
          setEditing(false);
          tree.refetch();
        },
      },
      {
        name: "read_revision_history",
        description: "Narration hook — agent narrates revisions aloud.",
        run: () => {
          /* No revision UI yet; pure narration. */
        },
      },
      {
        name: "revert_to_revision",
        description: "Refetch after a revert.",
        run: () => {
          page.refetch();
        },
      },
    ]);
  }, [path, tree, page]);

  // Group tree by layer for a calm sidebar.
  const grouped = useMemo(() => {
    const out = new Map<string, WikiNode[]>();
    for (const n of tree.data ?? []) {
      const arr = out.get(n.layer) ?? [];
      arr.push(n);
      out.set(n.layer, arr);
    }
    for (const arr of out.values()) {
      arr.sort((a, b) => a.path.localeCompare(b.path));
    }
    return out;
  }, [tree.data]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <KgHeader
        label="wiki"
        right={
          path ? (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="font-mono text-[10px] uppercase tracking-wider text-accent-indigo hover:underline"
            >
              {editing ? "cancel" : "edit"}
            </button>
          ) : null
        }
      />

      <div className="grid flex-1 min-h-0 grid-cols-[200px_1fr]">
        {/* tree */}
        <div className="muji-scroll min-h-0 overflow-y-auto border-r border-rule/40 p-2">
          {tree.error && (
            <p className="px-2 py-1 font-mono text-[10px] text-confidence-low">
              {tree.error.detail}
            </p>
          )}
          {tree.loading && !tree.data && (
            <p className="px-2 py-1 font-mono text-[10px] text-ink-35">loading…</p>
          )}
          {[...grouped.entries()].map(([layer, nodes]) => (
            <div key={layer} className="mb-2">
              <p className="px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-ink-35">
                {layer}
              </p>
              <ul className="space-y-0.5">
                {nodes.map((n) => (
                  <li key={n.path}>
                    <button
                      type="button"
                      onClick={() => {
                        setPath(n.path);
                        setEditing(false);
                      }}
                      style={{ paddingLeft: 8 + (n.depth - 1) * 10 }}
                      className={cn(
                        "block w-full truncate rounded py-1 pr-2 text-left font-mono text-[10px] transition-colors",
                        path === n.path
                          ? "bg-accent-indigo-soft text-accent-indigo"
                          : "text-ink-90 hover:bg-paper-2/60",
                      )}
                    >
                      {n.path.split("/").pop() || n.path}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* page */}
        <div className="muji-scroll min-h-0 overflow-y-auto p-3">
          <KgShell
            loading={page.loading && !page.data}
            error={page.error}
            empty={!page.data}
            emptyHint={path ? "page not found" : "pick a page on the left"}
            onRetry={page.refetch}
          >
            {page.data && !editing && (
              <article className="space-y-2">
                <header className="border-b border-rule/40 pb-2">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
                    {page.data.layer} · depth {page.data.depth}
                  </p>
                  <p className="font-mono text-[14px] text-ink-90">
                    {page.data.path}
                  </p>
                </header>
                <pre className="muji-scroll whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-ink-90">
                  {page.data.content || "(empty)"}
                </pre>
              </article>
            )}
            {page.data && editing && (
              <WikiEditor
                pageData={page.data}
                userId={userId}
                onCancel={() => setEditing(false)}
                onSaved={() => {
                  setEditing(false);
                  page.refetch();
                }}
              />
            )}
          </KgShell>
        </div>
      </div>
    </div>
  );
}

function WikiEditor({
  pageData,
  userId,
  onCancel,
  onSaved,
}: {
  pageData: WikiPage;
  userId: string | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState(pageData.content);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await writeWikiPage(
        pageData.path,
        { content, rationale: rationale.trim() || undefined },
        userId,
      );
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <header className="flex items-center justify-between border-b border-rule/40 pb-2">
        <p className="font-mono text-[12px] text-ink-90">
          editing · {pageData.path}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="font-mono text-[10px] text-ink-35 hover:text-ink-90"
        >
          cancel
        </button>
      </header>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
        className="muji-scroll min-h-[200px] flex-1 rounded border border-rule/50 bg-paper-2/40 p-2 font-mono text-[12px] leading-relaxed text-ink-90 focus:border-accent-indigo/50 focus:outline-none"
      />
      <input
        type="text"
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        placeholder="rationale (optional)"
        className="rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 placeholder:text-ink-35 focus:border-accent-indigo/50 focus:outline-none"
      />
      <div className="flex items-center justify-between">
        {err ? (
          <span className="font-mono text-[10px] text-confidence-low">{err}</span>
        ) : (
          <span className="font-mono text-[10px] text-ink-35">
            PUT /api/kg/wiki/{pageData.path} · no-op if unchanged
          </span>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="font-mono text-[10px] uppercase tracking-wider text-accent-indigo hover:underline disabled:opacity-40"
        >
          {busy ? "saving…" : "save"}
        </button>
      </div>
    </div>
  );
}
