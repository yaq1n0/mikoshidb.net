import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export const DB_SCHEMA_VERSION = 1 as const;

export const SESSION_DB_NAME = "mikoshi-session";
export const CACHE_DB_NAME = "mikoshi-cache";

// --- Persisted record types ---

export interface PersistedScrollbackLine {
  schemaVersion: 1;
  id?: number;
  kind: string;
  text: string;
  progress?: number;
  timestamp: number;
}

export interface PersistedChatSession {
  schemaVersion: 1;
  chatHistory: Array<{ role: "user" | "assistant"; content: string }>;
  firmwareId: string | null;
  engramId: string | null;
  startedAt: number;
  lastTurnAt: number;
}

export interface PersistedRagEntry {
  schemaVersion: 1;
  id?: number;
  preamble?: string;
  systemPrompt?: string;
  timing?: Record<string, number>;
  query?: string;
  response?: string;
  timestamp: number;
}

export interface PersistedBundleAsset {
  bytes: ArrayBuffer;
  storedAt: number;
  sizeBytes: number;
}

// --- DB schemas ---

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

export function openSessionDb(): Promise<IDBPDatabase<SessionDbSchema>> {
  return openDB<SessionDbSchema>(SESSION_DB_NAME, DB_SCHEMA_VERSION, {
    upgrade(db) {
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
      if (!db.objectStoreNames.contains("rag-log")) {
        db.createObjectStore("rag-log", {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    },
  });
}

export function openCacheDb(): Promise<IDBPDatabase<CacheDbSchema>> {
  return openDB<CacheDbSchema>(CACHE_DB_NAME, DB_SCHEMA_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("bundle-assets")) {
        // out-of-line string key (sha256)
        db.createObjectStore("bundle-assets");
      }
    },
  });
}
