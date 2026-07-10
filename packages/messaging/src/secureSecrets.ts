const secureSecretsDatabaseName = "cop.secure-secrets.v1";
const secureSecretsDatabaseVersion = 1;
const secureSecretsStoreName = "secrets";
const secureWrappingKeysStoreName = "wrappingKeys";
const sealedSecretVersion = 1;

export interface BrowserSecretScope {
  homeserverBaseUrl: string;
  id: string;
  userId: string;
}

interface StoredWrappingKey {
  createdAt: string;
  id: string;
  key: CryptoKey;
  version: typeof sealedSecretVersion;
}

interface StoredSealedSecret {
  alg: "AES-GCM";
  ciphertext: string;
  homeserverBaseUrl: string;
  id: string;
  iv: string;
  updatedAt: string;
  userId: string;
  version: typeof sealedSecretVersion;
  wrappingKeyId: string;
}

export async function requestDurableBrowserStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage) {
    return false;
  }
  try {
    const alreadyPersisted =
      typeof navigator.storage.persisted === "function" ? await navigator.storage.persisted() : false;
    if (alreadyPersisted) {
      return true;
    }
    return typeof navigator.storage.persist === "function" ? await navigator.storage.persist() : false;
  } catch {
    return false;
  }
}

export async function readSealedBrowserSecret(scope: BrowserSecretScope): Promise<string | undefined> {
  const database = await openSecureSecretsDatabase();
  if (!database) {
    return undefined;
  }
  try {
    const stored = await readObjectStoreValue<StoredSealedSecret>(database, secureSecretsStoreName, scope.id);
    if (!isStoredSealedSecretForScope(stored, scope)) {
      return undefined;
    }
    const wrappingKey = await readObjectStoreValue<StoredWrappingKey>(
      database,
      secureWrappingKeysStoreName,
      stored.wrappingKeyId
    );
    if (!isStoredWrappingKey(wrappingKey)) {
      return undefined;
    }
    const decrypted = await globalThis.crypto.subtle.decrypt(
      {
        additionalData: secretScopeAdditionalData(scope),
        iv: decodeBase64Url(stored.iv),
        name: "AES-GCM"
      },
      wrappingKey.key,
      decodeBase64Url(stored.ciphertext)
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return undefined;
  } finally {
    database.close();
  }
}

export async function writeSealedBrowserSecret(scope: BrowserSecretScope, secret: string): Promise<boolean> {
  if (!secret.trim()) {
    return false;
  }
  void requestDurableBrowserStorage();
  const database = await openSecureSecretsDatabase();
  if (!database) {
    return false;
  }
  try {
    const wrappingKey = await readOrCreateWrappingKey(database, wrappingKeyIdForScope(scope));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>;
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      {
        additionalData: secretScopeAdditionalData(scope),
        iv,
        name: "AES-GCM"
      },
      wrappingKey,
      new TextEncoder().encode(secret.trim())
    );
    await writeObjectStoreValue<StoredSealedSecret>(database, secureSecretsStoreName, {
      alg: "AES-GCM",
      ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
      homeserverBaseUrl: scope.homeserverBaseUrl,
      id: scope.id,
      iv: encodeBase64Url(iv),
      updatedAt: new Date().toISOString(),
      userId: scope.userId,
      version: sealedSecretVersion,
      wrappingKeyId: wrappingKeyIdForScope(scope)
    });
    return true;
  } catch {
    return false;
  } finally {
    database.close();
  }
}

async function readOrCreateWrappingKey(database: IDBDatabase, id: string): Promise<CryptoKey> {
  const stored = await readObjectStoreValue<StoredWrappingKey>(database, secureWrappingKeysStoreName, id);
  if (isStoredWrappingKey(stored)) {
    return stored.key;
  }
  const key = await globalThis.crypto.subtle.generateKey({ length: 256, name: "AES-GCM" }, false, [
    "decrypt",
    "encrypt"
  ]);
  await writeObjectStoreValue<StoredWrappingKey>(database, secureWrappingKeysStoreName, {
    createdAt: new Date().toISOString(),
    id,
    key,
    version: sealedSecretVersion
  });
  return key;
}

async function openSecureSecretsDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined" || !globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    return null;
  }
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(secureSecretsDatabaseName, secureSecretsDatabaseVersion);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(secureSecretsStoreName)) {
        database.createObjectStore(secureSecretsStoreName, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(secureWrappingKeysStoreName)) {
        database.createObjectStore(secureWrappingKeysStoreName, { keyPath: "id" });
      }
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
  });
}

async function readObjectStoreValue<T>(database: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
  const transaction = database.transaction(storeName, "readonly");
  const request = transaction.objectStore(storeName).get(key);
  const value = await requestToPromise<unknown>(request);
  return value === undefined ? undefined : (value as T);
}

async function writeObjectStoreValue<T extends { id: string }>(
  database: IDBDatabase,
  storeName: string,
  value: T
): Promise<void> {
  const transaction = database.transaction(storeName, "readwrite");
  const request = transaction.objectStore(storeName).put(value);
  await requestToPromise(request);
  await transactionDone(transaction);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.oncomplete = () => resolve();
  });
}

function isStoredSealedSecretForScope(value: unknown, scope: BrowserSecretScope): value is StoredSealedSecret {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.version === sealedSecretVersion &&
    value.alg === "AES-GCM" &&
    value.id === scope.id &&
    value.userId === scope.userId &&
    value.homeserverBaseUrl === scope.homeserverBaseUrl &&
    typeof value.iv === "string" &&
    typeof value.ciphertext === "string" &&
    typeof value.wrappingKeyId === "string"
  );
}

function isStoredWrappingKey(value: unknown): value is StoredWrappingKey {
  return (
    isRecord(value) && value.version === sealedSecretVersion && typeof value.id === "string" && isCryptoKey(value.key)
  );
}

function isCryptoKey(value: unknown): value is CryptoKey {
  return typeof value === "object" && value !== null && "algorithm" in value && "type" in value && "usages" in value;
}

function wrappingKeyIdForScope(scope: BrowserSecretScope): string {
  return `${scope.id}.wrappingKey`;
}

function secretScopeAdditionalData(scope: BrowserSecretScope): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `${scope.id}\n${scope.userId}\n${scope.homeserverBaseUrl}`
  ) as Uint8Array<ArrayBuffer>;
}

function encodeBase64Url(bytes: Uint8Array): string {
  const base64 = typeof btoa === "function" ? btoa(bytesToBinary(bytes)) : Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/gu, "+")
    .replace(/_/gu, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = typeof atob === "function" ? atob(padded) : Buffer.from(padded, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length) as Uint8Array<ArrayBuffer>;
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBinary(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return binary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
