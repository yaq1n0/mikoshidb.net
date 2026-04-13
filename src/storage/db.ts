import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export const DB_SCHEMA_VERSION = 2 as const;

export const SESSION_DB_NAME = "mikoshi-session";
export const CACHE_DB_NAME = "mikoshi-cache";

// --- Persisted record types ---

export type PersistedScrollbackLine = {
  schemaVersion: 1;
  id?: number;
  kind: string;
  text: string;
  progress?: number;
  timestamp: number;
};

export type PersistedChatSession = {
  schemaVersion: 1;
  chatHistory: Array<{ role: "user" | "assistant"; content: string }>;
  firmwareId: string | null;
  engramId: string | null;
  startedAt: number;
  lastTurnAt: number;
};

export type PersistedRagEntry = {
  schemaVersion: 2;
  id?: number;
  timestamp: number;
  query?: string;
  engramId?: string | null;
  cutoffEventId?: string | null;
  resolverInput?: unknown;
  resolverMessages?: unknown;
  resolverRaw?: string;
  resolverOutput?: unknown;
  resolverFallback?: "none" | "empty-directive" | "parse-error" | "throw";
  resolvedEntities?: Array<{ alias: string; articleId: string }>;
  traversalNodes?: unknown;
  selected?: unknown;
  preamble?: string;
  systemPrompt?: string;
  timing?: Record<string, number>;
};

export type PersistedBundleAsset = {
  bytes: ArrayBuffer;
  storedAt: number;
  sizeBytes: number;
};


export interface SessionDbSchema extends DBSchema {
  scrollback: {
    key: number;
    value: PersistedScrollbackLine;
    indexes: { "by-timestamp": number };
  };
  "chat-session": {
    key: string;
    value: PersistedChatSession;
  };
  "rag-log": {
    key: number;
    value: PersistedRagEntry;
  };
}

export interface CacheDbSchema extends DBSchema {
  "bundle-assets": {
    key: string;
    value: PersistedBundleAsset;
  };
}

// --- Openers ---

/** Opens session db. */
export const openSessionDb = (): Promise<IDBPDatabase<SessionDbSchema>> => {
  return openDB<SessionDbSchema>(SESSION_DB_NAME, DB_SCHEMA_VERSION, {
    upgrade(db, oldVersion) {
      if (!db.objectStoreNames.contains("scrollback")) {
        const scrollback = db.createObjectStore("scrollback", {
          keyPath: "id",
          autoIncrement: true,
        });
        scrollback.createIndex("by-timestamp", "timestamp");
      }
      if (!db.objectStoreNames.contains("chat-session")) {
        // out-of-line key; single record under "current"
        db.createObjectStore("chat-session");
      }
      // v1 → v2: rag-log schema changed from embedding-rag shape to graph-rag.
      // Wipe the store so stale records don't leak into the new UI.
      if (oldVersion < 2 && db.objectStoreNames.contains("rag-log")) {
        db.deleteObjectStore("rag-log");
      }
      if (!db.objectStoreNames.contains("rag-log")) {
        db.createObjectStore("rag-log", {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    },
  });
};

/** Opens cache db. */
export const openCacheDb = (): Promise<IDBPDatabase<CacheDbSchema>> => {
  return openDB<CacheDbSchema>(CACHE_DB_NAME, DB_SCHEMA_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("bundle-assets")) {
        // out-of-line string key (sha256)
        db.createObjectStore("bundle-assets");
      }
    },
  });
};
