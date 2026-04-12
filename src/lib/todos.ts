/** Count todo lines in a todos.md document. */
export function countTodos(text: string): { total: number; done: number } {
  let total = 0;
  let done = 0;
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*[-*]?\s*\[([ xX])\]\s*(.*)$/);
    if (match) {
      total++;
      if (match[1].toLowerCase() === "x") done++;
    }
  }
  return { total, done };
}

/** Validate a todos.md document against limits. Returns null if valid, or an error message. */
export function validateTodosText(
  text: string,
  selfHosted: boolean,
): string | null {
  if (selfHosted) return null;

  const bytes = new TextEncoder().encode(text).length;
  if (bytes > 10240) {
    return "Document exceeds 10 KB limit";
  }

  const { total } = countTodos(text);
  if (total > 200) {
    return "Document exceeds 200 todo limit";
  }

  return null;
}

/** Derive a URL-safe slug from a display name. */
export function toSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-") // spaces and underscores → hyphens
    .replace(/[^a-z0-9.-]/g, "") // strip anything else
    .replace(/-+/g, "-") // collapse multiple hyphens
    .replace(/^-|-$/g, ""); // trim leading/trailing hyphens
}

/** Reserved slugs that cannot be used. */
const RESERVED_SLUGS = new Set(["t", "w"]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

/** Validate a category name. Returns null if valid, or an error message. */
export function validateCategoryName(name: string): string | null {
  if (!name || name.trim().length === 0) return "Name is required";
  if (name.length > 100) return "Name is too long";
  const slug = toSlug(name);
  if (!slug) return "Name must contain at least one letter or number";
  if (isReservedSlug(slug)) return `"${name}" is a reserved name`;
  return null;
}
