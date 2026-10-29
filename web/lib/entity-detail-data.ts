import type { EntityDetail } from "./api/backend";

export function entityDetailCollections(data: Partial<EntityDetail>) {
  return {
    aliases: data.aliases ?? [],
    tags: data.tags ?? [],
    appearsInEdges: data.appears_in_edges ?? [],
    mentions: data.mentions ?? [],
  };
}
