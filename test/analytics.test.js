import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { addAnalyticsEvent, analyticsSummary, cleanupAnalytics } from "../src/analytics.js";
import { createDatabase } from "../src/db.js";

function temporaryDatabase(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jev-analytics-"));
  const database = createDatabase(path.join(directory, "test.db"));
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return database;
}

test("analytics summary counts visitors, judgments, and interactions", (t) => {
  const database = temporaryDatabase(t);
  const now = new Date("2026-09-21T08:00:00Z");
  const add = (eventType, visitorHash, options = {}) => addAnalyticsEvent({
    eventType,
    visitorHash,
    date: now,
    database,
    ...options,
  });

  add("page_view", "visitor-a");
  add("page_view", "visitor-a");
  add("page_view", "visitor-b");
  add("evaluation_success", "visitor-a", { dimension: "noul", value: 120 });
  add("evaluation_success", "visitor-b", { dimension: "choice", value: 280 });
  add("evaluation_failure", "visitor-a", { dimension: "jev_timeout" });
  add("sample_select", "visitor-b", { dimension: "ticket" });
  add("register_success", "visitor-b", { userId: "user-b" });

  const summary = analyticsSummary({ days: 7, now, database });
  assert.equal(summary.overview.pv, 3);
  assert.equal(summary.overview.uv, 2);
  assert.equal(summary.overview.dau, 2);
  assert.equal(summary.overview.evaluations, 2);
  assert.equal(summary.overview.evaluators, 2);
  assert.equal(summary.overview.evaluationRate, 1);
  assert.equal(summary.overview.successRate, 2 / 3);
  assert.equal(summary.overview.avgLatencyMs, 200);
  assert.equal(summary.overview.registrations, 1);
  assert.deepEqual(summary.primitiveUsage, [
    { name: "choice", count: 1 },
    { name: "noul", count: 1 },
  ]);
  assert.deepEqual(summary.interactions, [
    { name: "sample_select", dimension: "ticket", count: 1 },
  ]);
});

test("analytics cleanup removes events outside retention", (t) => {
  const database = temporaryDatabase(t);
  addAnalyticsEvent({
    eventType: "page_view",
    visitorHash: "old-visitor",
    date: new Date("2026-01-01T00:00:00Z"),
    database,
  });
  assert.equal(cleanupAnalytics({ now: new Date("2026-09-21T00:00:00Z"), database }), 1);
});
