/** PATCH /:slug — rename list. */
export async function patchListName(
  slug: string,
  name: string,
): Promise<{ name: string; slug: string } | null> {
  const res = await fetch(`/${slug}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return null;
  return (await res.json()) as { name: string; slug: string };
}
