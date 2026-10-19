import assert from "node:assert/strict";
import test from "node:test";
import { installPage } from "../src/install-page.js";
import { loadCatalog } from "../src/catalog.js";

test("counts searchable events across both cities without a snapshot-specific total", () => {
  const events = loadCatalog().events;
  const available = events.filter((event) => !event.labels.some((label) => label.toLowerCase() === "closed"));
  assert.ok(available.some((event) => event.city === "sf"));
  assert.ok(available.some((event) => event.city === "la"));
  const html = installPage("https://events.example.com");
  assert.match(html, /<h1>Tech Week MCP<\/h1>/);
  assert.ok(html.includes(`Archive of ${available.length.toLocaleString("en-US")} past events`));
});

test("labels the service as deprecated and historical", () => {
  const html = installPage("https://events.example.com");
  assert.match(html, /class="deprecation-banner"/);
  assert.match(html, /<strong>Deprecated\.<\/strong> SF and LA Tech Week 2026 are over/);
  assert.match(html, /<meta name="description" content="Tech Week MCP is deprecated\./);
  assert.doesNotMatch(html, /Explore [\d,]+ events/);
});

test("renders client installation actions from the deployment origin", () => {
  const html = installPage("https://events.example.com");
  assert.match(html, /codex mcp add tech-week --url https:\/\/events\.example\.com\/mcp/);
  assert.match(html, /claude mcp add --transport http tech-week https:\/\/events\.example\.com\/mcp/);
  assert.match(html, /cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=tech-week/);
  assert.match(html, />Cursor<\/a>/);
  assert.match(html, /id="install-command"/);
  assert.match(html, /data-client="codex"/);
  assert.match(html, /data-client="claude"/);
  assert.match(html, /data-client="config"/);
  assert.match(html, /<img class="background" src="\/golden-gate-watercolor\.png" alt=""/);
  assert.doesNotMatch(html, /Useful by design|check_rsvp_status/);
});

test("escapes an unexpected origin before inserting it into HTML", () => {
  const html = installPage('https://example.com\"><script>alert(1)</script>');
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /\\u003cscript\\u003ealert\(1\)\\u003c\/script\\u003e/);
});
