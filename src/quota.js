import crypto from "node:crypto";
import { config } from "./config.js";
import { db as defaultDb } from "./db.js";

export function shanghaiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function anonymizeIp(ip) {
  return crypto
    .createHmac("sha256", config.ipHashSecret)
    .update(ip || "unknown")
    .digest("hex");
}

export function getUsage({ subjectType, subjectId, date = new Date(), database = defaultDb }) {
  const usageDate = shanghaiDateKey(date);
  const row = database.prepare(`
    SELECT count FROM daily_usage
    WHERE subject_type = ? AND subject_id = ? AND usage_date = ?
  `).get(subjectType, subjectId, usageDate);
  return row?.count || 0;
}

export function reserveUsage({ subjectType, subjectId, limit, date = new Date(), database = defaultDb }) {
  const usageDate = shanghaiDateKey(date);
  const now = Date.now();
  const reserve = database.transaction(() => {
    const current = database.prepare(`
      SELECT count FROM daily_usage
      WHERE subject_type = ? AND subject_id = ? AND usage_date = ?
    `).get(subjectType, subjectId, usageDate)?.count || 0;

    if (current >= limit) {
      return { allowed: false, used: current, remaining: 0, limit, usageDate };
    }

    database.prepare(`
      INSERT INTO daily_usage(subject_type, subject_id, usage_date, count, updated_at)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(subject_type, subject_id, usage_date)
      DO UPDATE SET count = count + 1, updated_at = excluded.updated_at
    `).run(subjectType, subjectId, usageDate, now);

    return {
      allowed: true,
      used: current + 1,
      remaining: limit - current - 1,
      limit,
      usageDate,
    };
  });
  return reserve();
}

export function refundUsage({ subjectType, subjectId, date = new Date(), database = defaultDb }) {
  const usageDate = shanghaiDateKey(date);
  database.prepare(`
    UPDATE daily_usage
    SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END,
        updated_at = ?
    WHERE subject_type = ? AND subject_id = ? AND usage_date = ?
  `).run(Date.now(), subjectType, subjectId, usageDate);
}

export function quotaFor(user, ip, database = defaultDb) {
  const authenticated = Boolean(user);
  const subjectType = authenticated ? "user" : "ip";
  const subjectId = authenticated ? user.id : anonymizeIp(ip);
  const limit = authenticated
    ? config.authenticatedDailyLimit
    : config.anonymousDailyLimit;
  const used = getUsage({ subjectType, subjectId, database });
  return {
    authenticated,
    subjectType,
    subjectId,
    limit,
    used,
    remaining: Math.max(0, limit - used),
  };
}
