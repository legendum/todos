import { getDb } from "../../lib/db.js";
import { json } from "../json.js";

export function getMe(userId: number): Response {
  const db = getDb();
  const row = db
    .query("SELECT legendum_token FROM users WHERE id = ?")
    .get(userId) as {
      legendum_token: string | null;
    } | undefined;

  if (!row) return json({ error: "not_found" }, 404);

  return json({
    legendum_linked: !!row.legendum_token,
  });
}
