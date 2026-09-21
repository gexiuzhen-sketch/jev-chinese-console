import path from "node:path";

const isProduction = process.env.NODE_ENV === "production";

function requiredSecret(name) {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (isProduction) throw new Error(`${name} is required in production`);
  return `development-only-${name.toLowerCase()}-change-me`;
}

export const config = Object.freeze({
  isProduction,
  port: Number.parseInt(process.env.PORT || "8787", 10),
  publicOrigin: process.env.PUBLIC_ORIGIN?.replace(/\/$/, "") || "",
  typeSafeApiKey: process.env.TYPESAFE_API_KEY?.trim() || "",
  sessionSecret: requiredSecret("SESSION_SECRET"),
  ipHashSecret: requiredSecret("IP_HASH_SECRET"),
  analyticsAdminToken: requiredSecret("ANALYTICS_ADMIN_TOKEN"),
  dbPath: process.env.DB_PATH || path.resolve("data/jev-console.db"),
  anonymousDailyLimit: 10,
  authenticatedDailyLimit: 30,
  sessionDays: 30,
  maxStateLength: 12_000,
  analyticsRetentionDays: 90,
});
