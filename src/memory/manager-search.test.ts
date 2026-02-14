import { describe, expect, it } from "vitest";
import { buildFtsQuery } from "./hybrid.js";
import { searchKeyword } from "./manager-search.js";
import { requireNodeSqlite } from "./sqlite.js";

describe("manager-search keyword scoring", () => {
  it("assigns descending reciprocal text scores by BM25 rank order", async () => {
    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(":memory:");
    db.exec(
      `CREATE VIRTUAL TABLE chunks_fts USING fts5(
        text,
        id UNINDEXED,
        path UNINDEXED,
        source UNINDEXED,
        model UNINDEXED,
        start_line UNINDEXED,
        end_line UNINDEXED
      );`,
    );

    const insert = db.prepare(
      `INSERT INTO chunks_fts (text, id, path, source, model, start_line, end_line)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run("alpha", "a", "memory/a.md", "memory", "mock-model", 1, 1);
    insert.run("alpha alpha alpha alpha", "b", "memory/b.md", "memory", "mock-model", 1, 1);
    insert.run("alpha beta", "c", "memory/c.md", "memory", "mock-model", 1, 1);

    const results = await searchKeyword({
      db,
      ftsTable: "chunks_fts",
      providerModel: "mock-model",
      query: "alpha",
      limit: 10,
      snippetMaxChars: 700,
      sourceFilter: { sql: "", params: [] },
      buildFtsQuery,
    });

    expect(results.length).toBeGreaterThan(1);
    expect(results[0]?.textScore).toBeCloseTo(1);
    expect(results[1]?.textScore).toBeCloseTo(0.5);
    expect(
      results.every((row, i, arr) => {
        const prev = i > 0 ? arr[i - 1] : undefined;
        return prev ? row.textScore < prev.textScore : true;
      }),
    ).toBe(true);

    db.close();
  });
});
