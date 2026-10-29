import { describe, expect, it } from "vitest";
import { entityDetailCollections } from "../../lib/entity-detail-data";

describe("entityDetailCollections", () => {
  it("provides empty relation arrays for incomplete list-row payloads", () => {
    expect(
      entityDetailCollections({
        name: "Ada",
      }),
    ).toEqual({
      aliases: [],
      tags: [],
      appearsInEdges: [],
      mentions: [],
    });
  });
});
