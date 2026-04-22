import { chargeWebhookWrite } from "../../lib/billing.js";
import { getDb } from "../../lib/db.js";
import { isSelfHosted } from "../../lib/mode.js";
import { broadcast, subscribe } from "../../lib/sse.js";
import { validateTodosText } from "../../lib/todos.js";
import { json } from "../json.js";

type ListRow = {
  id: number;
  user_id: number;
  ulid: string;
  name: string;
  slug: string;
  text: string;
  updated_at: number;
};

function findByUlid(ulid: string): ListRow | undefined {
  const db = getDb();
  return db
    .query(
      "SELECT id, user_id, ulid, name, slug, text, updated_at FROM lists WHERE ulid = ?",
    )
    .get(ulid) as ListRow | undefined;
}

/** GET /w/:ulid — get todos */
export function getWebhookTodos(ulid: string): Response {
  const row = findByUlid(ulid);
  if (!row) return json({ error: "not_found", reason: "ulid" }, 404);

  return new Response(row.text, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "X-Updated-At": String(row.updated_at),
      "X-List-Slug": row.slug,
      "X-List-Name": row.name,
    },
  });
}

/** PUT or POST /w/:ulid — replace all todos */
export async function replaceWebhookTodos(
  req: Request,
  ulid: string,
): Promise<Response> {
  const row = findByUlid(ulid);
  if (!row) return json({ error: "not_found", reason: "ulid" }, 404);

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
  db.run(
    "UPDATE lists SET text = ?, updated_at = ? WHERE id = ?",
    text,
    now,
    row.id,
  );
  broadcast(ulid, text);

  return new Response(text, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "X-Updated-At": String(now),
    },
  });
}

/** Interval for SSE comment pings — avoids idle TCP/proxy timeouts (~60–120s) with no todo updates. */
const SSE_HEARTBEAT_MS = 20_000;

/** GET /w/:ulid/events — SSE stream */
export function sseStream(ulid: string, signal?: AbortSignal): Response {
  const row = findByUlid(ulid);
  if (!row) return json({ error: "not_found", reason: "ulid" }, 404);

  let unsubscribe: (() => void) | undefined;
  let onAbort: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const close = () => {
        if (heartbeat !== undefined) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
        unsubscribe?.();
        unsubscribe = undefined;
        onAbort = undefined;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      controller.enqueue(encoder.encode(formatSSE(row.text)));

      // Comment lines — ignored by EventSource; keeps chunked responses flowing past idle timeouts.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode("\n: keep-alive\n\n"));
        } catch {
          close();
        }
      }, SSE_HEARTBEAT_MS);

      unsubscribe = subscribe(ulid, (text) => {
        try {
          controller.enqueue(encoder.encode(formatSSE(text)));
        } catch {
          close();
        }
      });

      if (signal) {
        if (signal.aborted) {
          close();
          return;
        }
        onAbort = () => close();
        signal.addEventListener("abort", onAbort);
      }
    },
    cancel() {
      if (heartbeat !== undefined) {
        clearInterval(heartbeat);
        heartbeat = undefined;
      }
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      unsubscribe?.();
      unsubscribe = undefined;
      onAbort = undefined;
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
