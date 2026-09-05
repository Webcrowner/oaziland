/**
 * offline/queue.ts — the offline action queue. Any action a user takes
 * while offline (creating a listing, sending a message) is written
 * here FIRST, then synced to the real API once connectivity returns.
 *
 * WHY every queued action carries an idempotencyKey generated at
 * QUEUE TIME (not at sync time): if a sync attempt actually reaches
 * the server but the success response is lost (a dropped connection
 * mid-response, common on a flaky mobile network), retrying the SAME
 * queued action must not create a duplicate booking/listing/message.
 * This mirrors the exact pattern already built server-side —
 * Booking.idempotency_key (Prompt 5) and Message.client_message_id
 * (the founder's offline-messaging addition) — the mobile app is what
 * actually EXERCISES those server-side guarantees from a real client.
 */
import * as SQLite from "expo-sqlite";

export type QueuedActionType = "CREATE_HOUSE_AND_LISTING" | "SEND_MESSAGE";

export type QueueItemStatus = "PENDING" | "SYNCED" | "FAILED";

export interface QueueItem {
  id: number;
  actionType: QueuedActionType;
  payload: string; // JSON-serialized
  idempotencyKey: string;
  status: QueueItemStatus;
  attempts: number;
  createdAt: string;
}

let dbInstance: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync("oaziland_offline.db");
    await dbInstance.execAsync(`
      CREATE TABLE IF NOT EXISTS offline_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }
  return dbInstance;
}

function generateIdempotencyKey(): string {
  // A simple, real, collision-resistant-enough client-side ID —
  // deliberately not a full UUID library dependency for this single use.
  return `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Queues an action for later sync. Returns the idempotency key so the
 * UI can optimistically show the action as "pending" using the same
 * key it will later be confirmed or reconciled by. */
export async function enqueueAction(actionType: QueuedActionType, payload: object): Promise<string> {
  const db = await getDb();
  const idempotencyKey = generateIdempotencyKey();
  await db.runAsync(
    "INSERT INTO offline_queue (action_type, payload, idempotency_key) VALUES (?, ?, ?)",
    [actionType, JSON.stringify(payload), idempotencyKey]
  );
  return idempotencyKey;
}

export async function getPendingActions(): Promise<QueueItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    "SELECT id, action_type as actionType, payload, idempotency_key as idempotencyKey, status, attempts, created_at as createdAt FROM offline_queue WHERE status != 'SYNCED' ORDER BY created_at ASC"
  );
  return rows;
}

async function markSynced(id: number) {
  const db = await getDb();
  await db.runAsync("UPDATE offline_queue SET status = 'SYNCED' WHERE id = ?", [id]);
}

async function markFailed(id: number, attempts: number) {
  const db = await getDb();
  await db.runAsync("UPDATE offline_queue SET status = 'FAILED', attempts = ? WHERE id = ?", [attempts + 1, id]);
}

const MAX_SYNC_ATTEMPTS = 5;

/**
 * Attempts to sync every pending/failed-but-retriable queued action to
 * the real API, using the injected `sender` function — this is what
 * lets the sync LOGIC be tested with a fake sender, without a real
 * network or a real device, while the same function drives real
 * syncing in production.
 */
export async function syncQueue(sender: (item: QueueItem) => Promise<boolean>): Promise<{ synced: number; failed: number }> {
  const items = await getPendingActions();
  let synced = 0;
  let failed = 0;

  for (const item of items) {
    if (item.attempts >= MAX_SYNC_ATTEMPTS) continue; // give up after repeated failures, don't retry forever

    try {
      const success = await sender(item);
      if (success) {
        await markSynced(item.id);
        synced++;
      } else {
        await markFailed(item.id, item.attempts);
        failed++;
      }
    } catch {
      await markFailed(item.id, item.attempts);
      failed++;
    }
  }

  return { synced, failed };
}

/** Test/dev helper — never used in the real app flow. */
export async function _resetQueueForTests() {
  const db = await getDb();
  await db.runAsync("DELETE FROM offline_queue");
}
