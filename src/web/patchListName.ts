/** PATCH /api/lists/:ulid — rename a list via pues. */
export async function patchListName(
  ulid: string,
  name: string,
): Promise<{ name: string; slug: string } | null> {
  const res = await fetch(`/api/lists/${encodeURIComponent(ulid)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: name }),
  });
  if (!res.ok) return null;
  const row = (await res.json()) as {
    label: string;
    slug?: string;
  };
  return { name: row.label, slug: row.slug ?? "" };
}
