import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { db } from "./db.js";

export const SESSION_COOKIE = "jev_session";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function registerUser({ email, displayName, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existing) {
    const error = new Error("该邮箱已注册");
    error.code = "EMAIL_EXISTS";
    throw error;
  }
  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare(`
    INSERT INTO users(id, email, display_name, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, normalizedEmail, displayName.trim(), passwordHash, Date.now());
  return { id, email: normalizedEmail, displayName: displayName.trim() };
}

export async function authenticateUser(email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  const row = db.prepare(`
    SELECT id, email, display_name, password_hash FROM users WHERE email = ?
  `).get(normalizedEmail);
  if (!row || !(await bcrypt.compare(password, row.password_hash))) return null;
  return { id: row.id, email: row.email, displayName: row.display_name };
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const now = Date.now();
  const expiresAt = now + config.sessionDays * 24 * 60 * 60 * 1000;
  db.prepare(`
    INSERT INTO sessions(token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(tokenHash, userId, expiresAt, now);
  return { token, expiresAt };
}

export function setSessionCookie(response, token, expiresAt) {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(response) {
  response.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    path: "/",
  });
}

export function currentUser(request) {
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const now = Date.now();
  const row = db.prepare(`
    SELECT users.id, users.email, users.display_name
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash, now);
  if (!row) return null;
  return { id: row.id, email: row.email, displayName: row.display_name };
}

export function revokeSession(request) {
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function cleanupExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}
