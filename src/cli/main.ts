#!/usr/bin/env bun

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const TODOS_FILE = "todos.txt";

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

/** Parse todos.txt content into lines. */
type TodoLine = { done: boolean; text: string };
type ParsedLine = { isTodo: true; todo: TodoLine } | { isTodo: false; raw: string };

function parseContent(content: string): ParsedLine[] {
  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
  if (!trimmed) return [];
  return trimmed.split("\n").map((line) => {
    if (line.startsWith("[ ] ")) {
      return { isTodo: true, todo: { done: false, text: line.slice(4) } };
    }
    if (line.startsWith("[x] ")) {
      return { isTodo: true, todo: { done: true, text: line.slice(4) } };
    }
    return { isTodo: false, raw: line };
  });
}

function serializeContent(lines: ParsedLine[]): string {
  if (lines.length === 0) return "";
  return lines
    .map((l) => {
      if (l.isTodo) return `${l.todo.done ? "[x]" : "[ ]"} ${l.todo.text}`;
      return l.raw;
    })
    .join("\n") + "\n";
}

/** Get todo lines only (with their index in the full array). */
function getTodoLines(lines: ParsedLine[]): Array<{ index: number; todo: TodoLine }> {
  const result: Array<{ index: number; todo: TodoLine }> = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.isTodo) result.push({ index: i, todo: l.todo });
  }
  return result;
}

/** Merge local and server content. */
function merge(local: string, server: string): string {
  const localLines = parseContent(local);
  const serverLines = parseContent(server);

  // Use server order as base
  const result = [...serverLines];

  // Find local todos not in server (by text)
  const serverTexts = new Set(
    serverLines.filter((l) => l.isTodo).map((l) => (l as { isTodo: true; todo: TodoLine }).todo.text),
  );

  for (const line of localLines) {
    if (line.isTodo && !serverTexts.has(line.todo.text)) {
      result.push(line);
    }
  }

  // Done wins: if either side has a todo marked done, keep it done
  const localDone = new Set(
    localLines
      .filter((l) => l.isTodo && (l as { isTodo: true; todo: TodoLine }).todo.done)
      .map((l) => (l as { isTodo: true; todo: TodoLine }).todo.text),
  );

  for (const line of result) {
    if (line.isTodo && localDone.has(line.todo.text)) {
      line.todo.done = true;
    }
  }

  return serializeContent(result);
}

/** Print todos with line numbers. */
function printTodos(content: string): void {
  const lines = parseContent(content);
  let todoNum = 0;
  for (const line of lines) {
    if (line.isTodo) {
      todoNum++;
      const prefix = line.todo.done ? "[x]" : "[ ]";
      console.log(`${todoNum}. ${prefix} ${line.todo.text}`);
    } else if (line.raw.trim()) {
      console.log(`   ${line.raw}`);
    }
  }
  if (todoNum === 0) {
    console.log("   (no todos)");
  }
}

async function main() {
  let webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    webhookUrl = promptWebhookUrl();
  }

  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();
  const positions = args.slice(1).map(Number).filter((n) => !Number.isNaN(n) && n > 0);

  // Read local todos.txt
  const todosPath = join(process.cwd(), TODOS_FILE);
  let localContent = "";
  if (existsSync(todosPath)) {
    localContent = readFileSync(todosPath, "utf-8");
  }

  // Fetch server content
  let serverContent = "";
  let online = true;
  try {
    const res = await fetch(webhookUrl, { method: "GET" });
    if (res.ok) {
      serverContent = await res.text();
    } else {
      online = false;
    }
  } catch {
    online = false;
  }

  // Merge
  let content: string;
  if (online) {
    content = localContent ? merge(localContent, serverContent) : serverContent;
  } else {
    content = localContent;
    if (!online && args.length > 0) {
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
  } else if ((command === "del" || command === "delete") && positions.length > 0) {
    const todos = getTodoLines(lines);
    const indicesToRemove = new Set(
      positions.filter((p) => p >= 1 && p <= todos.length).map((p) => todos[p - 1].index),
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
        headers: { "Content-Type": "text/plain" },
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
