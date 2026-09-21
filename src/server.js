import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { z } from "zod";
import { config } from "./config.js";
import {
  authenticateUser,
  cleanupExpiredSessions,
  clearSessionCookie,
  createSession,
  currentUser,
  registerUser,
  revokeSession,
  setSessionCookie,
} from "./auth.js";
import { db } from "./db.js";
import {
  anonymizeIp,
  quotaFor,
  refundUsage,
  reserveUsage,
} from "./quota.js";
import { evaluateWithJev, evaluationSchema } from "./jev.js";
import {
  addAnalyticsEvent,
  analyticsSummary,
  cleanupAnalytics,
  ensureVisitor,
} from "./analytics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(__dirname, "../public");
const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  strictTransportSecurity: config.isProduction
    ? { maxAge: 31_536_000, includeSubDomains: true }
    : false,
}));
app.use(express.json({ limit: "64kb" }));
app.use(cookieParser(config.sessionSecret));

function clientIp(request) {
  return request.ip || request.socket.remoteAddress || "unknown";
}

function requireSameOrigin(request, response, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return next();
  const origin = request.get("origin");
  if (!config.isProduction || !origin || origin === config.publicOrigin) return next();
  return response.status(403).json({ error: "请求来源无效" });
}

app.use("/api", requireSameOrigin);

const burstBuckets = new Map();
function burstLimit(scope, max, windowMs) {
  return (request, response, next) => {
    const now = Date.now();
    const key = `${scope}:${anonymizeIp(clientIp(request))}`;
    const bucket = burstBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      burstBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > max) {
      response.set("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return response.status(429).json({ error: "操作过于频繁，请稍后再试" });
    }
    return next();
  };
}

const authSchema = z.object({
  email: z.string().trim().email("请输入有效邮箱").max(254),
  password: z.string().min(8, "密码至少 8 位").max(128, "密码过长"),
});

const registerSchema = authSchema.extend({
  displayName: z.string().trim().min(1, "请输入昵称").max(40, "昵称过长"),
});

const clientAnalyticsSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("page_view") }).strict(),
  z.object({ event: z.literal("cta_click"), dimension: z.enum(["playground", "cases"]) }).strict(),
  z.object({ event: z.literal("sample_select"), dimension: z.enum(["ticket", "review", "priority"]) }).strict(),
  z.object({ event: z.literal("primitive_select"), dimension: z.enum(["noul", "choice", "score"]) }).strict(),
  z.object({ event: z.literal("auth_open"), dimension: z.enum(["login", "register"]) }).strict(),
]);

function recordEvent(request, response, eventType, { dimension = null, value = null, user = undefined } = {}) {
  try {
    const authenticatedUser = user === undefined ? currentUser(request) : user;
    addAnalyticsEvent({
      eventType,
      visitorHash: ensureVisitor(request, response),
      userId: authenticatedUser?.id || null,
      dimension,
      value,
    });
  } catch (error) {
    console.error("Analytics event failed", { eventType, message: error.message });
  }
}

function hasAdminAccess(request) {
  const authorization = request.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(config.analyticsAdminToken);
  return suppliedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function sessionPayload(request, authenticatedUser) {
  const user = authenticatedUser === undefined ? currentUser(request) : authenticatedUser;
  const quota = quotaFor(user, clientIp(request));
  return {
    user,
    quota: {
      limit: quota.limit,
      used: quota.used,
      remaining: quota.remaining,
    },
  };
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    jevConfigured: Boolean(config.typeSafeApiKey),
    time: new Date().toISOString(),
  });
});

app.get("/api/session", (request, response) => {
  response.set("Cache-Control", "no-store");
  response.json(sessionPayload(request));
});

app.post("/api/analytics/event", burstLimit("analytics", 120, 60_000), (request, response) => {
  const parsed = clientAnalyticsSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "统计事件无效" });
  const event = parsed.data;
  recordEvent(request, response, event.event, { dimension: event.dimension || null });
  return response.status(204).end();
});

app.get("/api/admin/analytics", burstLimit("analytics-admin", 30, 60_000), (request, response) => {
  response.set("Cache-Control", "no-store");
  if (!hasAdminAccess(request)) {
    return response.status(401).json({ error: "管理员口令无效" });
  }
  const parsed = z.coerce.number().int().min(1).max(90).safeParse(request.query.days || 30);
  if (!parsed.success) return response.status(400).json({ error: "统计周期无效" });
  return response.json(analyticsSummary({ days: parsed.data }));
});

app.post("/api/auth/register", burstLimit("register", 8, 15 * 60_000), async (request, response, next) => {
  const ipId = anonymizeIp(clientIp(request));
  const registration = reserveUsage({
    subjectType: "registration",
    subjectId: ipId,
    limit: 3,
  });
  if (!registration.allowed) {
    return response.status(429).json({ error: "当前网络今天注册次数已达上限" });
  }

  try {
    const input = registerSchema.parse(request.body);
    const user = await registerUser(input);
    const session = createSession(user.id);
    setSessionCookie(response, session.token, session.expiresAt);
    recordEvent(request, response, "register_success", { user });
    return response.status(201).json(sessionPayload(request, user));
  } catch (error) {
    refundUsage({ subjectType: "registration", subjectId: ipId });
    if (error instanceof z.ZodError) {
      return response.status(400).json({ error: error.issues[0]?.message || "注册信息无效" });
    }
    if (error.code === "EMAIL_EXISTS") {
      return response.status(409).json({ error: "该邮箱已注册，请直接登录" });
    }
    return next(error);
  }
});

app.post("/api/auth/login", burstLimit("login", 12, 15 * 60_000), async (request, response, next) => {
  try {
    const input = authSchema.parse(request.body);
    const user = await authenticateUser(input.email, input.password);
    if (!user) return response.status(401).json({ error: "邮箱或密码不正确" });
    const session = createSession(user.id);
    setSessionCookie(response, session.token, session.expiresAt);
    recordEvent(request, response, "login_success", { user });
    return response.json(sessionPayload(request, user));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response.status(400).json({ error: error.issues[0]?.message || "登录信息无效" });
    }
    return next(error);
  }
});

app.post("/api/auth/logout", (request, response) => {
  revokeSession(request);
  clearSessionCookie(response);
  response.json({ ok: true });
});

app.post("/api/evaluate", burstLimit("evaluate", 25, 60_000), async (request, response, next) => {
  let input;
  try {
    input = evaluationSchema.parse(request.body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response.status(400).json({ error: error.issues[0]?.message || "判断配置无效" });
    }
    return next(error);
  }

  const user = currentUser(request);
  const quota = quotaFor(user, clientIp(request));
  const reservation = reserveUsage({
    subjectType: quota.subjectType,
    subjectId: quota.subjectId,
    limit: quota.limit,
  });
  if (!reservation.allowed) {
    return response.status(429).json({
      error: user ? "今日 30 次体验额度已用完，明天再来吧" : "今日 10 次匿名额度已用完，登录后可提升到 30 次",
      code: user ? "DAILY_LIMIT" : "SIGN_IN_REQUIRED",
      quota: { limit: quota.limit, used: reservation.used, remaining: 0 },
    });
  }

  try {
    const startedAt = performance.now();
    const result = await evaluateWithJev(input);
    const latencyMs = Math.round(performance.now() - startedAt);
    recordEvent(request, response, "evaluation_success", {
      dimension: input.type,
      value: latencyMs,
      user,
    });
    return response.json({
      result: { ...result, latencyMs },
      quota: {
        limit: quota.limit,
        used: reservation.used,
        remaining: reservation.remaining,
      },
    });
  } catch (error) {
    refundUsage({ subjectType: quota.subjectType, subjectId: quota.subjectId });
    recordEvent(request, response, "evaluation_failure", {
      dimension: ["JEV_NOT_CONFIGURED", "JEV_RATE_LIMIT", "JEV_TIMEOUT"].includes(error.code)
        ? error.code.toLowerCase()
        : "unknown",
      user,
    });
    if (error.code === "JEV_NOT_CONFIGURED") {
      return response.status(503).json({ error: "Jev 服务正在完成配置，请稍后再试" });
    }
    if (error.code === "JEV_RATE_LIMIT") {
      return response.status(503).json({ error: "Jev 当前请求较多，请稍后再试" });
    }
    if (error.code === "JEV_TIMEOUT") {
      return response.status(504).json({ error: error.message });
    }
    return next(error);
  }
});

app.use(express.static(publicDirectory, {
  etag: true,
  maxAge: config.isProduction ? "1h" : 0,
  index: "index.html",
}));

app.use((error, _request, response, _next) => {
  console.error("Request failed", {
    name: error.name,
    code: error.code,
    message: error.message,
  });
  response.status(500).json({ error: "服务暂时不可用，请稍后再试" });
});

cleanupExpiredSessions();
cleanupAnalytics();
setInterval(() => {
  cleanupExpiredSessions();
  cleanupAnalytics();
  const cutoff = Date.now() - 60 * 60_000;
  for (const [key, bucket] of burstBuckets) {
    if (bucket.resetAt < cutoff) burstBuckets.delete(key);
  }
}, 60 * 60_000).unref();

const server = app.listen(config.port, "127.0.0.1", () => {
  console.log(`Jev console listening on http://127.0.0.1:${config.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
