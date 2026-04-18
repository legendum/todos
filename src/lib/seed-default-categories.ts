import { getDb } from "./db.js";
import { toSlug } from "./todos.js";
import { ulid } from "./ulid.js";

const DEFAULT_LISTS: readonly { name: string; text: string }[] = [
  {
    name: "Today",
    text: `[ ] check this item as done
[ ] click the logo to learn more`,
  },
  {
    name: "Ideas",
    text: `[ ] read https://legendum.co.uk/services
[ ] go for a walk in nature`,
  },
];

/** Insert starter lists for a newly created user (no billing charge). */
export function seedDefaultCategoriesForNewUser(userId: number): void {
  const db = getDb();
  let position = 0;
  for (const { name, text } of DEFAULT_LISTS) {
    const slug = toSlug(name);
    db.run(
      "INSERT INTO categories (user_id, ulid, name, slug, position, text) VALUES (?, ?, ?, ?, ?, ?)",
      userId,
      ulid(),
      name,
      slug,
      position,
      text,
    );
    position++;
  }
}
