/**
 * `mountAuthRoutes()` — returns the three OAuth routes under
 * `/pues/auth/*`. Mounted only in hosted mode (returns `{}` when
 * `isByLegendum()` is false, so the consumer's `routes:` block keeps
 * the OAuth surface entirely absent in self-hosted deployments).
 *
 * The callback orchestrates the OAuth exchange:
 *   verify state cookie → SDK.exchangeCode → find-or-create user via
 *   UserStorage → fire `onNewUser` if created (else refresh
 *   legendum_token) → set session cookie → redirect to `/`.
 */

import { createRequire } from "node:module";
import { isByLegendum } from "../core/mode";
import {
  clearAuthCookieHeader,
  OAUTH_STATE_COOKIE_NAME,
  setAuthCookieHeader,
} from "./cookie";
import { getAuthConfig, getDomain } from "./startup";
import { getUserStorage } from "./storage";

const require = createRequire(import.meta.url);
const legendumSdk =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("./legendum.js") as typeof import("./legendum");

type LegendumExchange = {
  email: string;
  linked?: boolean;
  account_token?: string;
};

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function getLogin(_req: Request): Promise<Response> {
  const domain = getDomain();
  const state = crypto.randomUUID();
  const redirectUri = `${domain}/pues/auth/callback`;

  const linkData = await legendumSdk.requestLink();
  const url = legendumSdk.authAndLinkUrl({
    redirectUri,
    state,
    linkCode: linkData.code,
  });

  const stateCookie = `${OAUTH_STATE_COOKIE_NAME}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`;
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Set-Cookie": stateCookie },
  });
}

async function getCallback(req: Request): Promise<Response> {
  const domain = getDomain();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return json(
      { error: "invalid_request", message: "Missing code or state" },
      400,
    );
  }

  const cookieHeader = req.headers.get("Cookie") ?? "";
  const stateMatch = cookieHeader.match(
    new RegExp(`${OAUTH_STATE_COOKIE_NAME}=([^;]+)`),
  );
  const savedState = stateMatch?.[1];
  if (state !== savedState) {
    return json({ error: "invalid_state", message: "State mismatch" }, 400);
  }

  const redirectUri = `${domain}/pues/auth/callback`;

  let data: LegendumExchange;
  try {
    data = (await legendumSdk.exchangeCode(
      code,
      redirectUri,
    )) as LegendumExchange;
  } catch (err: unknown) {
    console.error("Legendum code exchange failed", err);
    return json({ error: "auth_failed", message: "Login failed" }, 400);
  }

  const { email } = data;
  if (!email) {
    return json(
      { error: "auth_failed", message: "Could not read email from Legendum" },
      400,
    );
  }

  const accountToken = data.account_token ?? null;
  const storage = getUserStorage();
  let user = await storage.findUserByEmail(email);

  if (!user) {
    user = await storage.createUser({ email, legendumToken: accountToken });
    const config = getAuthConfig();
    if (config.onNewUser) await config.onNewUser(user.id);
  } else if (accountToken && user.legendum_token !== accountToken) {
    await storage.updateLegendumToken(user.id, accountToken);
  }

  const sessionCookie = setAuthCookieHeader(user.id);
  const clearState = `${OAUTH_STATE_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

  return new Response(null, {
    status: 302,
    headers: [
      ["Location", `${domain}/`],
      ["Set-Cookie", sessionCookie],
      ["Set-Cookie", clearState],
    ] as [string, string][],
  });
}

async function postLogout(): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearAuthCookieHeader(),
    },
  });
}

export function mountAuthRoutes(): Record<
  string,
  Record<string, (req: Request) => Response | Promise<Response>>
> {
  if (!isByLegendum()) return {};
  return {
    "/pues/auth/login": { GET: getLogin },
    "/pues/auth/callback": { GET: getCallback },
    "/pues/auth/logout": { POST: postLogout },
  };
}
