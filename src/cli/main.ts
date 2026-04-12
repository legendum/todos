#!/usr/bin/env bun

import { execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { ParsedLine, TodoLine } from "../lib/todos";
import { parseContent, serializeContent } from "../lib/todos";

const TODOS_FILE = "todos.md";

/** Read TODOS_WEBHOOK from .env in the current directory. */
function getWebhookUrl(): string | null {
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return null;
  const content = readFileSync(envPath, "utf-8");
  const match = content.match(/^TODOS_WEBHOOK=(.+)$/m);
  return match?.[1]?.trim() || null;
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
  const fd = require("node:fs").openSync("/dev/stdin", "r");
  const n = require("node:fs").readSync(fd, buf, 0, 1024, null);
  require("node:fs").closeSync(fd);
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

/** Merge local and server content. The newer side wins for done state. */

/** Print todos with line numbers. */
function printTodos(content: string): void {
  const lines = parseContent(content);
  let todoNum = 0;
  for (const line of lines) {
    if (line.isTodo) {
      todoNum++;
      const prefix = line.todo.done ? "[x]" : "[ ]";
      console.log(
        `${line.todo.indent || ""}${todoNum}. ${prefix} ${line.todo.text}`,
      );
    } else if (line.raw.trim()) {
      console.log(`   ${line.raw}`);
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

async function main() {
  let webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    webhookUrl = promptWebhookUrl();
  }

  const args = process.argv.slice(2);
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
  let online = true;
  try {
    const res = await fetch(webhookUrl, { method: "GET" });
    if (res.ok) {
      serverContent = await res.text();
      serverUpdatedAt = Number(res.headers.get("X-Updated-At") || "0");
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
  } else if (command === "undo" && positions.length > 0) {
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
  } else if (command === "skill" && args.length === 1) {
    installSkill();
    return;
  } else if (command === "open" && args.length === 1) {
    // Open in browser
    const baseUrl = webhookUrl.replace(/\/w\/[A-Z0-9]+$/, "");
    try {
      execSync(`open "${baseUrl}"`, { stdio: "ignore" });
    } catch {
      console.log(`Open: ${baseUrl}`);
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
