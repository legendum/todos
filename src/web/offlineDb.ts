/** IndexedDB mirror for category markdown + list (offline reads / pending PUT replay). */

const DB_NAME = "todos-offline";
const DB_VERSION = 1;

export type CategoryListEntry = {
  name: string;
  slug: string;
  ulid: string;
  position: number;
  total: number;
  done: number;
  updated_at: number;
};

export type MarkdownCache = {
  slug: string;
  text: string;
  /** Last known server `updated_at` (unix seconds). */
  updatedAt: number;
  pending: boolean;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("markdown")) {
          db.createObjectStore("markdown", { keyPath: "slug" });
        }
      };
    });
  }
  return dbPromise;
}

type MetaRow = {
  key: "categoriesList";
  categories: CategoryListEntry[];
  fetchedAt: number;
};

async function readMeta<K extends MetaRow["key"]>(
  key: K,
): Promise<Extract<MetaRow, { key: K }> | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readonly");
    const req = tx.objectStore("meta").get(key);
    req.onsuccess = () =>
      resolve((req.result as Extract<MetaRow, { key: K }>) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function writeMeta(row: MetaRow): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore("meta").put(row);
  });
}

export async function saveCategoriesList(
  categories: CategoryListEntry[],
): Promise<void> {
  await writeMeta({
    key: "categoriesList",
    categories,
    fetchedAt: Date.now(),
  });
}

export async function getCategoriesList(): Promise<CategoryListEntry[] | null> {
  const row = await readMeta("categoriesList");
  return row?.categories ?? null;
}

export async function findCategoryInList(
  slug: string,
): Promise<CategoryListEntry | null> {
  const list = await getCategoriesList();
  return list?.find((c) => c.slug === slug) ?? null;
}

export async function getMarkdown(slug: string): Promise<MarkdownCache | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("markdown", "readonly");
    const req = tx.objectStore("markdown").get(slug);
    req.onsuccess = () => resolve((req.result as MarkdownCache) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMarkdown(cache: MarkdownCache): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("markdown", "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore("markdown").put(cache);
  });
}

export async function deleteMarkdown(slug: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("markdown", "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore("markdown").delete(slug);
  });
}

/** Pending PUTs waiting for network (one IndexedDB pass). */
export async function getPendingMarkdowns(): Promise<MarkdownCache[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out: MarkdownCache[] = [];
    const tx = db.transaction("markdown", "readonly");
    const req = tx.objectStore("markdown").openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(out);
        return;
      }
      const row = cursor.value as MarkdownCache;
      if (row.pending) out.push(row);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
