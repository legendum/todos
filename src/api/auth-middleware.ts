import { getUserIdFromRequest } from "../lib/auth.js";
import { getDb } from "../lib/db.js";
import { json } from "./json.js";

// @ts-expect-error — pure JS SDK
const legendum = require("../lib/legendum.js");

/** Try cookie auth first, then Bearer token (Legendum account key). */
export function getAuthUserId(req: Request): number | null {
  // Cookie auth
  const userId = getUserIdFromRequest(req);
  if (userId) {
    const db = getDb();
    const row = db.query("SELECT 1 FROM users WHERE id = ?").get(userId);
    return row ? userId : null;
  }
  return null;
}

/** Resolve a Bearer token (lak_...) to a user ID by looking up legendum_token. */
export async function getAuthUserIdWithBearer(req: Request): Promise<number | null> {
  // Cookie first
  const cookieId = getAuthUserId(req);
  if (cookieId) return cookieId;

  // Bearer token (Legendum account key)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const accountKey = authHeader.slice(7).trim();
  if (!accountKey) return null;

  // Use legendum SDK to resolve account key to a token
  if (!legendum.isConfigured()) return null;

  try {
    const { token } = await legendum.linkAccount(accountKey);
    if (!token) return null;

    const db = getDb();
    // Find user by legendum_token
    const row = db
      .query("SELECT id FROM users WHERE legendum_token = ?")
      .get(token) as { id: number } | undefined;
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request): { userId: number } | Response {
  const userId = getAuthUserId(req);
  if (!userId) {
    return json({ error: "unauthorized", message: "Not authenticated" }, 401);
  }
  return { userId };
}

export async function requireAuthAsync(req: Request): Promise<{ userId: number } | Response> {
  const userId = await getAuthUserIdWithBearer(req);
  if (!userId) {
    return json({ error: "unauthorized", message: "Not authenticated" }, 401);
  }
  return { userId };
}
