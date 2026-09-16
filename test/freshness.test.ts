import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalog } from "../src/catalog.js";

test("catalog includes snapshot_generated_at as an ISO-8601 UTC string", () => {
  const catalog = loadCatalog() as any;
  assert.ok(
    typeof catalog.snapshot_generated_at === "string" && catalog.snapshot_generated_at.length > 0,
    "snapshot_generated_at should be present"
  );
  assert.doesNotThrow(() => {
    const parsed = Date.parse(catalog.snapshot_generated_at);
    if (Number.isNaN(parsed)) throw new Error("Unparseable date");
  });
  assert.match(catalog.snapshot_generated_at, /Z$/, "timestamp should be UTC (Z-suffix)");
});

