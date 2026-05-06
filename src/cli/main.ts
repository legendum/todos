#!/usr/bin/env bun

import { execSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { ParsedLine, TodoLine } from "../lib/todos";
import { parseContent, purgeDoneTodos, serializeContent } from "../lib/todos";

const TODOS_FILE = "todos.md";

/** Read TODOS_WEBHOOK from .env in the current directory. */
function getWebhookUrlFromEnvFile(): string | null {
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return null;
  const content = readFileSync(envPath, "utf-8");
  const match = content.match(/^TODOS_WEBHOOK=(.+)$/m);
  return match?.[1]?.trim() || null;
}

/** Strip `-w` / `--webhook` from argv; last flag wins. */
function parseWebhookFlags(argv: string[]): {
  webhook: string | null;
  rest: string[];
} {
  const rest: string[] = [];
  let webhook: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-w" || a === "--webhook") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        console.error("todos: -w / --webhook requires a URL");
        process.exit(1);
      }
      webhook = next;
      i++;
      continue;
    }
    if (a.startsWith("--webhook=")) {
      const v = a.slice("--webhook=".length).trim();
      if (!v) {
        console.error("todos: --webhook= requires a non-empty URL");
        process.exit(1);
      }
      webhook = v;
      continue;
    }
    rest.push(a);
  }
  return { webhook, rest };
}

/** Prompt user for webhook URL and save to .env */
function promptWebhookUrl(): string {
  process.stdout.write("Enter your Todos webhook URL: ");
  const url = readLineSync().trim();
  if (!url) {
    console.error("No URL provided. Exiting.");
    process.exit(1);
  }
  const envPath = join(process.cwd(), ".env");
  let content = "";
  if (existsSync(envPath)) {
    content = readFileSync(envPath, "utf-8");
    if (content.includes("TODOS_WEBHOOK=")) {
      content = content.replace(/^TODOS_WEBHOOK=.*$/m, `TODOS_WEBHOOK=${url}`);
    } else {
      content += `\nTODOS_WEBHOOK=${url}\n`;
    }
  } else {
    content = `TODOS_WEBHOOK=${url}\n`;
  }
  writeFileSync(envPath, content);
  return url;
}

function readLineSync(): string {
  const buf = Buffer.alloc(1024);
  const fd = openSync("/dev/stdin", "r");
  const n = readSync(fd, buf, 0, 1024, null);
  closeSync(fd);
  return buf.toString("utf-8", 0, n).replace(/\n$/, "");
}

/** Get todo lines only (with their index in the full array). */
function getTodoLines(
  lines: ParsedLine[],
): Array<{ index: number; todo: TodoLine }> {
  const result: Array<{ index: number; todo: TodoLine }> = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.isTodo) result.push({ index: i, todo: l.todo });
  }
  return result;
}

/** Print todos with line numbers. */
function printTodos(content: string): void {
  const lines = parseContent(content);
  let todoNum = 0;
  for (const line of lines) {
    if (line.isTodo) {
      todoNum++;
      const prefix = line.todo.done ? "[x]" : "[ ]";
      const indent = line.todo.indent || "";
      console.log(`${indent}${todoNum}. ${prefix} ${line.todo.text}`);
    } else if (line.raw.trim()) {
      console.log(line.raw);
    }
  }
  if (todoNum === 0) {
    console.log("   (no todos)");
  }
}

/** Bundled skill text; copied to agent skill dirs by `todos skill`. */
const SKILL_SOURCE_REL = join("config", "SKILL.md");

/**
 * Globally linked `todos` runs from `~/.config/todos/src`, so the skill is read from
 * `~/.config/todos/src/config/SKILL.md` first. The `__dirname` fallback supports running
 * the CLI directly (e.g. `bun src/cli/main.ts skill`) from any clone.
 */
function installSkill(): void {
  const home = process.env.HOME || "~";
  const linkedInstallRoot = join(home, ".config/todos/src");
  const cliRepoRoot = join(dirname(dirname(__dirname)));
  const skillSource = [
    join(linkedInstallRoot, SKILL_SOURCE_REL),
    join(cliRepoRoot, SKILL_SOURCE_REL),
  ].find(existsSync);

  if (!skillSource) {
    console.error(
      "Could not find config/SKILL.md (expected under ~/.config/todos/src or next to the CLI).",
    );
    process.exit(1);
  }

  const destinations = [
    join(home, ".claude", "skills", "todos", "SKILL.md"),
    join(home, ".cursor", "skills", "todos", "SKILL.md"),
  ];

  for (const dest of destinations) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(skillSource, dest);
    console.log(`  ${dest}`);
  }

  console.log("\nInstalled todos skill for Claude Code and Cursor.");
}

function printHelp(): void {
  console.log(`todos — sync a local todos.md with your webhook

Usage:
  todos                    list todos (numbered)
  todos <text>             add a todo
  todos done <n> [...]     mark position(s) done
  todos todo <n> [...]     mark position(s) not done
  todos del|delete <n>     delete todo at position
  todos first <n> [...]    move position(s) to the top
  todos last <n> [...]     move position(s) to the bottom
  todos purge              remove all done items
  todos undo               undo last full-document edit
  todos redo               redo after undo
  todos open               open this list in the browser
  todos skill              install agent skill for Claude Code / Cursor
  todos help               show this message

Options:
  -w URL, --webhook URL    use this webhook for this run only (--webhook=URL ok)

Webhook resolution: -w flag, then TODOS_WEBHOOK in .env, then $TODOS_WEBHOOK,
then interactive prompt.

Webhook URL: open https://todos.in, choose a todo list, then tap or click the
identifier line under the list name at the top — it copies the webhook to your
clipboard. Paste that into .env, pass -w, or export TODOS_WEBHOOK.
`);
}

async function fetchWebhookDocHistory(
  webhookUrl: string,
  kind: "undo" | "redo",
): Promise<void> {
  const u = new URL(webhookUrl);
  const p = u.pathname.replace(/\/$/, "");
  const res = await fetch(`${u.origin}${p}/${kind}`, { method: "POST" });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { message?: string };
      if (j.message) msg = j.message;
    } catch {
      /* ignore */
    }
    console.error(`${kind} failed (${res.status}): ${msg}`);
    process.exit(1);
  }
  const text = await res.text();
  const todosPath = join(process.cwd(), TODOS_FILE);
  writeFileSync(todosPath, text);
  printTodos(text);
}

async function main() {
  const rawArgv = process.argv.slice(2);
  const { webhook: webhookFromFlag, rest: args } = parseWebhookFlags(rawArgv);
  if (
    args.length === 1 &&
    (args[0] === "--help" ||
      args[0] === "-h" ||
      args[0].toLowerCase() === "help")
  ) {
    printHelp();
    return;
  }

  let webhookUrl =
    webhookFromFlag?.trim() ||
    getWebhookUrlFromEnvFile() ||
    process.env.TODOS_WEBHOOK?.trim() ||
    null;
  if (!webhookUrl) {
    webhookUrl = promptWebhookUrl();
  }

  const command = args[0]?.toLowerCase();
  const positions = args
    .slice(1)
    .map(Number)
    .filter((n) => !Number.isNaN(n) && n > 0);

  // Read local todos.md
  const todosPath = join(process.cwd(), TODOS_FILE);
  let localContent = "";
  if (existsSync(todosPath)) {
    localContent = readFileSync(todosPath, "utf-8");
  }

  // Fetch server content
  let serverContent = "";
  let serverUpdatedAt = 0;
  let listSlug: string | null = null;
  let online = true;
  try {
    const res = await fetch(webhookUrl, { method: "GET" });
    if (res.ok) {
      serverContent = await res.text();
      serverUpdatedAt = Number(res.headers.get("X-Updated-At") || "0");
      listSlug = res.headers.get("X-List-Slug");
    } else {
      online = false;
    }
  } catch {
    online = false;
  }

  let content: string;
  if (online) {
    const localMtime = existsSync(todosPath)
      ? Math.floor(statSync(todosPath).mtimeMs / 1000)
      : 0;
    if (!localContent || localMtime <= serverUpdatedAt) {
      content = serverContent;
    } else {
      content = localContent;
    }
  } else {
    content = localContent;
    if (args.length > 0) {
      console.error("(offline — changes saved locally only)");
    }
  }

  let lines = parseContent(content);

  if (command === "undo") {
    if (args.length !== 1) {
      console.error(
        "Document undo: todos undo (no task numbers). To mark todos not done: todos todo <n> [...]",
      );
      process.exit(1);
    }
    if (!online) {
      console.error("(offline — cannot undo on server)");
      process.exit(1);
    }
    await fetchWebhookDocHistory(webhookUrl, "undo");
    return;
  }

  if (command === "redo") {
    if (args.length !== 1) {
      console.error("Document redo: todos redo (no arguments).");
      process.exit(1);
    }
    if (!online) {
      console.error("(offline — cannot redo on server)");
      process.exit(1);
    }
    await fetchWebhookDocHistory(webhookUrl, "redo");
    return;
  }

  // Handle commands
  if (!command || command === "list") {
    // Just list
  } else if (command === "done" && positions.length > 0) {
    const todos = getTodoLines(lines);
    for (const pos of positions) {
      if (pos >= 1 && pos <= todos.length) {
        todos[pos - 1].todo.done = true;
      }
    }
  } else if (command === "todo" && positions.length > 0) {
    const todos = getTodoLines(lines);
    for (const pos of positions) {
      if (pos >= 1 && pos <= todos.length) {
        todos[pos - 1].todo.done = false;
      }
    }
  } else if (
    (command === "del" || command === "delete") &&
    positions.length > 0
  ) {
    const todos = getTodoLines(lines);
    const indicesToRemove = new Set(
      positions
        .filter((p) => p >= 1 && p <= todos.length)
        .map((p) => todos[p - 1].index),
    );
    lines = lines.filter((_, i) => !indicesToRemove.has(i));
  } else if (command === "first" && positions.length > 0) {
    const todos = getTodoLines(lines);
    const toMove = positions
      .filter((p) => p >= 1 && p <= todos.length)
      .map((p) => todos[p - 1]);
    const moveIndices = new Set(toMove.map((t) => t.index));
    const remaining = lines.filter((_, i) => !moveIndices.has(i));
    const movedLines = toMove.map((t) => ({
      isTodo: true as const,
      todo: t.todo,
    }));
    lines = [...movedLines, ...remaining];
  } else if (command === "last" && positions.length > 0) {
    const todos = getTodoLines(lines);
    const toMove = positions
      .filter((p) => p >= 1 && p <= todos.length)
      .map((p) => todos[p - 1]);
    const moveIndices = new Set(toMove.map((t) => t.index));
    const remaining = lines.filter((_, i) => !moveIndices.has(i));
    const movedLines = toMove.map((t) => ({
      isTodo: true as const,
      todo: t.todo,
    }));
    lines = [...remaining, ...movedLines];
  } else if (command === "purge" && args.length === 1) {
    lines = purgeDoneTodos(lines);
  } else if (command === "skill" && args.length === 1) {
    installSkill();
    return;
  } else if (command === "open" && args.length === 1) {
    const origin = new URL(webhookUrl).origin;
    const slug = listSlug?.trim();
    const pageUrl =
      slug && slug.length > 0
        ? `${origin}/${encodeURIComponent(slug)}`
        : webhookUrl.replace(/\/w\/[A-Za-z0-9]+\/?$/, "");
    try {
      execSync(`open "${pageUrl}"`, { stdio: "ignore" });
    } catch {
      console.log(`Open: ${pageUrl}`);
    }
    return;
  } else {
    // Anything else is a new todo
    const text = args.join(" ");
    lines.push({ isTodo: true, todo: { done: false, text } });
  }

  content = serializeContent(lines);

  // Write local file
  writeFileSync(todosPath, content);

  // Push to server
  if (online) {
    try {
      await fetch(webhookUrl, {
        method: "PUT",
        headers: { "Content-Type": "text/markdown" },
        body: content,
      });
    } catch {
      console.error("(failed to sync to server)");
    }
  }

  // Print
  printTodos(content);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
