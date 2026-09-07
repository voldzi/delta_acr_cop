const databaseName = "cop-community-report-outbox";
const storeName = "drafts";
const recordVersion = 1;

interface StoredDraft<T> {
  draft: T;
  savedAt: string;
  scope: string;
  version: 1;
}

export function createCommunitySubmissionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? deterministicUuid(`${Date.now()}-${Math.random()}`);
}

export function communityAttachmentId(
  submissionId: string,
  file: Pick<File, "lastModified" | "name" | "size" | "type">
): string {
  return deterministicUuid(
    `${submissionId}\u0000${file.name}\u0000${file.size}\u0000${file.lastModified}\u0000${file.type}`
  );
}

export async function readCommunityReportOutbox<T>(scope: string): Promise<T | null> {
  const database = await openDatabase();
  if (!database) return null;
  try {
    const record = await requestResult<StoredDraft<T> | undefined>(
      database.transaction(storeName).objectStore(storeName).get(scope)
    );
    return record?.version === recordVersion ? record.draft : null;
  } finally {
    database.close();
  }
}

export async function writeCommunityReportOutbox<T>(scope: string, draft: T): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put({
      draft,
      savedAt: new Date().toISOString(),
      scope,
      version: recordVersion
    } satisfies StoredDraft<T>);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function clearCommunityReportOutbox(scope: string): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(scope);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

function deterministicUuid(input: string): string {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const words = seeds.map((seed, index) => fnv1a(`${index}:${input}`, seed));
  const hex = words
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("")
    .split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) % 4] ?? "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, recordVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName, { keyPath: "scope" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Community report outbox is unavailable."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Community report outbox request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Community report outbox transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Community report outbox transaction failed."));
  });
}
