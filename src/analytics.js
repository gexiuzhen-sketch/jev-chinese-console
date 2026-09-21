import crypto from "node:crypto";
import { config } from "./config.js";
import { db as defaultDb } from "./db.js";
import { shanghaiDateKey } from "./quota.js";

export const ANALYTICS_COOKIE = "jev_vid";

function hashVisitorToken(token) {
  return crypto
    .createHmac("sha256", config.ipHashSecret)
    .update(`visitor:${token}`)
    .digest("hex");
}

export function ensureVisitor(request, response) {
  let token = request.signedCookies?.[ANALYTICS_COOKIE];
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(token)) {
    token = crypto.randomBytes(24).toString("base64url");
    response.cookie(ANALYTICS_COOKIE, token, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: "lax",
      signed: true,
      path: "/",
      maxAge: 365 * 24 * 60 * 60 * 1000,
    });
  }
  return hashVisitorToken(token);
}

export function addAnalyticsEvent({
  eventType,
  visitorHash,
  userId = null,
  dimension = null,
  value = null,
  date = new Date(),
  database = defaultDb,
}) {
  database.prepare(`
    INSERT INTO analytics_events(
      event_type, visitor_hash, user_id, dimension, value, event_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventType,
    visitorHash,
    userId,
    dimension,
    Number.isInteger(value) ? value : null,
    shanghaiDateKey(date),
    date.getTime(),
  );
}

function dateKeyDaysAgo(daysAgo, now = new Date()) {
  return shanghaiDateKey(new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000));
}

export function analyticsSummary({ days = 30, now = new Date(), database = defaultDb } = {}) {
  const safeDays = Math.max(1, Math.min(90, Number(days) || 30));
  const sinceDate = dateKeyDaysAgo(safeDays - 1, now);
  const sevenDayDate = dateKeyDaysAgo(6, now);
  const today = shanghaiDateKey(now);

  const totals = database.prepare(`
    SELECT
      SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS pv,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_hash END) AS uv,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' AND event_date = ? THEN visitor_hash END) AS dau,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' AND event_date >= ? THEN visitor_hash END) AS active_7d,
      SUM(CASE WHEN event_type = 'evaluation_success' THEN 1 ELSE 0 END) AS evaluations,
      SUM(CASE WHEN event_type = 'evaluation_failure' THEN 1 ELSE 0 END) AS evaluation_failures,
      COUNT(DISTINCT CASE WHEN event_type = 'evaluation_success' THEN visitor_hash END) AS evaluators,
      ROUND(AVG(CASE WHEN event_type = 'evaluation_success' THEN value END)) AS avg_latency_ms,
      SUM(CASE WHEN event_type = 'register_success' THEN 1 ELSE 0 END) AS registrations,
      SUM(CASE WHEN event_type = 'login_success' THEN 1 ELSE 0 END) AS logins
    FROM analytics_events
    WHERE event_date >= ?
  `).get(today, sevenDayDate, sinceDate);

  const pv = Number(totals.pv || 0);
  const uv = Number(totals.uv || 0);
  const evaluations = Number(totals.evaluations || 0);
  const failures = Number(totals.evaluation_failures || 0);
  const evaluators = Number(totals.evaluators || 0);

  const daily = database.prepare(`
    SELECT
      event_date AS date,
      SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS pv,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN visitor_hash END) AS uv,
      SUM(CASE WHEN event_type = 'evaluation_success' THEN 1 ELSE 0 END) AS evaluations
    FROM analytics_events
    WHERE event_date >= ?
    GROUP BY event_date
    ORDER BY event_date ASC
  `).all(sinceDate).map((row) => ({
    date: row.date,
    pv: Number(row.pv || 0),
    uv: Number(row.uv || 0),
    evaluations: Number(row.evaluations || 0),
  }));

  const primitiveUsage = database.prepare(`
    SELECT dimension AS name, COUNT(*) AS count
    FROM analytics_events
    WHERE event_date >= ? AND event_type = 'evaluation_success'
    GROUP BY dimension
    ORDER BY count DESC, dimension ASC
  `).all(sinceDate).map((row) => ({ name: row.name, count: Number(row.count) }));

  const interactions = database.prepare(`
    SELECT event_type AS name, dimension, COUNT(*) AS count
    FROM analytics_events
    WHERE event_date >= ?
      AND event_type IN ('cta_click', 'sample_select', 'primitive_select', 'auth_open')
    GROUP BY event_type, dimension
    ORDER BY count DESC, event_type ASC, dimension ASC
  `).all(sinceDate).map((row) => ({
    name: row.name,
    dimension: row.dimension,
    count: Number(row.count),
  }));

  return {
    range: { days: safeDays, since: sinceDate, through: today },
    overview: {
      pv,
      uv,
      dau: Number(totals.dau || 0),
      active7d: Number(totals.active_7d || 0),
      evaluations,
      evaluators,
      evaluationRate: uv ? evaluators / uv : 0,
      successRate: evaluations + failures ? evaluations / (evaluations + failures) : 0,
      avgLatencyMs: Number(totals.avg_latency_ms || 0),
      registrations: Number(totals.registrations || 0),
      logins: Number(totals.logins || 0),
    },
    daily,
    primitiveUsage,
    interactions,
  };
}

export function cleanupAnalytics({ now = new Date(), database = defaultDb } = {}) {
  const cutoff = now.getTime() - config.analyticsRetentionDays * 24 * 60 * 60 * 1000;
  return database.prepare("DELETE FROM analytics_events WHERE created_at < ?").run(cutoff).changes;
}
