"use client";

/**
 * entity_detail window — full record for a single entity.
 *
 * Backed by `GET /api/kg/entities/{id}`. Edit form upserts via
 * `POST /api/kg/entities` (idempotent on `${entity_type}_${slug(name)}`).
 */

import { useCallback, useState } from "react";
import { useAgentStore } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import { entityDetailCollections } from "@/lib/entity-detail-data";
import {
  getEntity,
  upsertEntity,
  type EntityDetail,
} from "@/lib/api/backend";
import { KgShell, KgHeader } from "./kg-shell";

export function EntityDetailWindow({
  payload,
}: {
  payload?: Record<string, unknown>;
}) {
  const userId = useAgentStore((s) => s.userId);
  const id = (payload?.id as string) ?? "";
  const seed = (payload?.seed as EntityDetail | undefined) ?? null;

  const fetcher = useCallback(
    (signal: AbortSignal) =>
      id
        ? getEntity(id, userId, signal)
        : Promise.resolve(null as unknown as EntityDetail),
    [id, userId],
  );
  const { data, loading, error, refetch } = useKgResource(
    fetcher,
    `/api/kg/entities/${encodeURIComponent(id)}`,
    seed,
  );
  const collections = data ? entityDetailCollections(data) : null;

  const [editing, setEditing] = useState(false);

  if (!id) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="font-mono text-[11px] text-ink-35">
          no entity selected
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <KgHeader
        label={`entity · ${data?.entity_type ?? ""}`}
        right={
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="font-mono text-[10px] uppercase tracking-wider text-accent-indigo hover:underline"
          >
            {editing ? "cancel" : "edit"}
          </button>
        }
      />
      <div className="muji-scroll flex-1 min-h-0 overflow-y-auto p-3">
        <KgShell
          loading={loading}
          error={error}
          empty={!data}
          onRetry={refetch}
        >
          {data && !editing && (
            <div className="space-y-4">
              <div>
                <p className="font-mono text-[14px] text-ink-90">{data.name}</p>
                {data.description && (
                  <p className="mt-1 font-mono text-[12px] leading-relaxed text-ink-60">
                    {data.description}
                  </p>
                )}
              </div>

              {collections && collections.aliases.length > 0 && (
                <div>
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-35">
                    aliases
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {collections.aliases.map((a) => (
                      <span
                        key={a}
                        className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-60"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {collections && collections.tags.length > 0 && (
                <div>
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-35">
                    tags
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {collections.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded bg-accent-indigo-soft px-1.5 py-0.5 font-mono text-[10px] text-accent-indigo"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-35">
                  appears in · {collections?.appearsInEdges.length ?? 0}
                </p>
                {!collections?.appearsInEdges.length ? (
                  <p className="font-mono text-[11px] text-ink-35">
                    no integration edges
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {collections.appearsInEdges.map((edge, i) => (
                      <li
                        key={`${edge.integration_slug}-${i}`}
                        className="flex items-baseline justify-between rounded border border-rule/50 bg-paper-2/30 px-2 py-1"
                      >
                        <span className="font-mono text-[11px] text-ink-90">
                          {edge.integration_slug}
                          {edge.role && (
                            <span className="ml-1 text-ink-35">
                              · {edge.role}
                            </span>
                          )}
                        </span>
                        {edge.handle && (
                          <span className="font-mono text-[10px] text-ink-60">
                            {edge.handle}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-35">
                  mentions · {collections?.mentions.length ?? 0}
                </p>
                {!collections?.mentions.length ? (
                  <p className="font-mono text-[11px] text-ink-35">
                    not mentioned in any chat yet
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {collections.mentions.slice(0, 12).map((m, i) => (
                      <li
                        key={`${m.chat_id}-${i}`}
                        className="rounded border border-rule/50 bg-paper-2/30 px-2 py-1.5"
                      >
                        <p className="truncate font-mono text-[11px] text-ink-90">
                          {m.title || m.chat_id}
                        </p>
                        <p className="font-mono text-[9px] uppercase tracking-wider text-ink-35">
                          {m.source_type} · {m.mention_type}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {data && editing && (
            <EditEntityForm
              entity={data}
              userId={userId}
              onSaved={() => {
                setEditing(false);
                refetch();
              }}
            />
          )}
        </KgShell>
      </div>
    </div>
  );
}

function EditEntityForm({
  entity,
  userId,
  onSaved,
}: {
  entity: EntityDetail;
  userId: string | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState(entity.name);
  const [description, setDescription] = useState(entity.description ?? "");
  const [tags, setTags] = useState(entity.tags.join(", "));
  const [aliases, setAliases] = useState(entity.aliases.join(", "));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await upsertEntity(
        {
          name: name.trim(),
          entity_type: entity.entity_type,
          description: description.trim() || undefined,
          tags: tags
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          aliases: aliases
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
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
    <div className="space-y-2">
      <Field label="name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 focus:border-accent-indigo/50 focus:outline-none"
        />
      </Field>
      <Field label="description">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 focus:border-accent-indigo/50 focus:outline-none"
        />
      </Field>
      <Field label="aliases (comma-separated)">
        <input
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          className="w-full rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 focus:border-accent-indigo/50 focus:outline-none"
        />
      </Field>
      <Field label="tags (comma-separated)">
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="w-full rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 focus:border-accent-indigo/50 focus:outline-none"
        />
      </Field>
      <div className="flex items-center justify-between pt-1">
        {err ? (
          <span className="font-mono text-[10px] text-confidence-low">{err}</span>
        ) : (
          <span className="font-mono text-[10px] text-ink-35">
            POST /api/kg/entities · merges
          </span>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={busy || !name.trim()}
          className="font-mono text-[10px] uppercase tracking-wider text-accent-indigo hover:underline disabled:opacity-40"
        >
          {busy ? "saving…" : "save"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block font-mono text-[10px] uppercase tracking-wider text-ink-35">
        {label}
      </span>
      {children}
    </label>
  );
}
