import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabase } from "../src/db.js";
import { getUsage, refundUsage, reserveUsage, shanghaiDateKey } from "../src/quota.js";

function temporaryDatabase(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jev-quota-"));
  const database = createDatabase(path.join(directory, "test.db"));
  t.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return database;
}

test("Shanghai date key respects local midnight", () => {
  assert.equal(shanghaiDateKey(new Date("2026-09-21T15:59:59Z")), "2026-09-21");
  assert.equal(shanghaiDateKey(new Date("2026-09-21T16:00:00Z")), "2026-09-22");
});

test("anonymous quota stops exactly at the limit", (t) => {
  const database = temporaryDatabase(t);
  for (let index = 0; index < 10; index += 1) {
    const result = reserveUsage({ subjectType: "ip", subjectId: "abc", limit: 10, database });
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 9 - index);
  }
  const blocked = reserveUsage({ subjectType: "ip", subjectId: "abc", limit: 10, database });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.used, 10);
});

test("failed upstream request can refund quota", (t) => {
  const database = temporaryDatabase(t);
  reserveUsage({ subjectType: "user", subjectId: "u1", limit: 30, database });
  refundUsage({ subjectType: "user", subjectId: "u1", database });
  assert.equal(getUsage({ subjectType: "user", subjectId: "u1", database }), 0);
});
