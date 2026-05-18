/**
 * Module-singleton for pues' SSE route. server.ts wires `puesSse.routes`
 * into the route map; handlers (lists.ts, webhook.ts) import
 * `puesSse.broadcast` directly to bridge their bespoke writes back into
 * the pues event stream via `broadcastRow`.
 *
 * Replaces the previous setPuesBroadcast(...) registry pattern in
 * src/api/pues-runtime.ts — direct module import means handlers no
 * longer depend on server.ts boot order to receive the broadcast
 * function.
 */

import { resolveUser } from "pues/base/auth/server";
import { sseRoute } from "pues/base/sse";

export const puesSse = sseRoute({ resolveUser });
