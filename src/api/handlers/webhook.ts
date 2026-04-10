import { chargeWebhookWrite } from "../../lib/billing.js";
import { isSelfHosted } from "../../lib/mode.js";
import { getDb } from "../../lib/db.js";
import { broadcast, subscribe } from "../../lib/sse.js";
import { countTodos, validateTodosText } from "../../lib/todos.js";
import { json } from "../json.js";

type CategoryRow = {
  id: number;
  user_id: number;
  ulid: string;
  name: string;
  text: string;
  updated_at: number;
};

function findByUlid(ulid: string): CategoryRow | undefined {
  const db = getDb();
  return db
    .query("SELECT id, user_id, ulid, name, text, updated_at FROM categories WHERE ulid = ?")
    .get(ulid) as CategoryRow | undefined;
}

/** GET /w/:ulid — get todos */
export function getWebhookTodos(ulid: string): Response {
  const row = findByUlid(ulid);
  if (!row) return json({ error: "not_found" }, 404);

  return new Response(row.text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "X-Updated-At": String(row.updated_at),
    },
  });
}

/** PUT or POST /w/:ulid — replace all todos */
export async function replaceWebhookTodos(req: Request, ulid: string): Promise<Response> {
  const row = findByUlid(ulid);
  if (!row) return json({ error: "not_found" }, 404);

  // Charge for webhook write
  const chargeError = await chargeWebhookWrite(row.user_id);
  if (chargeError) return chargeError;

  const text = await req.text();
  const validationError = validateTodosText(text, isSelfHosted());
  if (validationError) {
    return json({ error: "invalid_request", message: validationError }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  db.run("UPDATE categories SET text = ?, updated_at = ? WHERE id = ?", text, now, row.id);
  broadcast(ulid, text);

  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "X-Updated-At": String(now),
    },
  });
}

/** GET /w/:ulid/events — SSE stream */
export function sseStream(ulid: string): Response {
  const row = findByUlid(ulid);
  if (!row) return json({ error: "not_found" }, 404);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial state
      const initial = formatSSE(row.text);
      controller.enqueue(encoder.encode(initial));

      // Subscribe to updates
      const unsubscribe = subscribe(ulid, (text) => {
        try {
          controller.enqueue(encoder.encode(formatSSE(text)));
        } catch {
          unsubscribe();
        }
      });

      // Clean up when client disconnects (detected by error on enqueue)
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function formatSSE(text: string): string {
  const lines = text.split("\n").map((line) => `data: ${line}`);
  return `event: update\n${lines.join("\n")}\n\n`;
}
