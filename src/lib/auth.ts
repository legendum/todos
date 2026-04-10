import { createHmac } from "node:crypto";

const COOKIE_NAME = "todos_session";
const MAX_AGE = 30 * 24 * 60 * 60; // 30 days

function getSecret(): string {
  return process.env.TODOS_COOKIE_SECRET ?? "dev-secret-change-in-production";
}

export function createSessionCookie(userId: number): string {
  const expires = Date.now() + MAX_AGE * 1000;
  const payload = `${userId}:${expires}`;
  const sig = createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}:${sig}`;
}

export function verifySessionCookie(cookie: string): number | null {
  const parts = cookie.split(":");
  if (parts.length !== 3) return null;
  const [userIdStr, expiresStr, sig] = parts;
  const payload = `${userIdStr}:${expiresStr}`;
  const expected = createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url");
  if (sig !== expected) return null;
  if (Date.now() > parseInt(expiresStr, 10)) return null;
  return parseInt(userIdStr, 10);
}

export function getUserIdFromRequest(req: Request): number | null {
  // Check Bearer token first (Legendum account key)
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    // Account key auth is handled at a higher level; this is for cookie auth
  }

  const cookie = req.headers.get("Cookie");
  if (!cookie) return null;
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verifySessionCookie(decodeURIComponent(match[1]));
}

export function getDomain(): string {
  if (process.env.NODE_ENV === "production") {
    return process.env.TODOS_DOMAIN || "https://todos.in";
  }
  return process.env.TODOS_DOMAIN || "http://localhost:3030";
}

export function setAuthCookieHeader(userId: number): string {
  const value = encodeURIComponent(createSessionCookie(userId));
  const isSecure = getDomain().startsWith("https://");
  const secureFlag = isSecure ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secureFlag}`;
}

export function clearAuthCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export { COOKIE_NAME };
