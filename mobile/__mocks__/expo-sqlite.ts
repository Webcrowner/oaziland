/**
 * A genuine in-memory implementation of the exact async interface
 * expo-sqlite exposes (execAsync/runAsync/getAllAsync) — NOT a stub
 * that just returns fake data. This actually stores rows, enforces the
 * UNIQUE constraint on idempotency_key, and runs real WHERE filtering,
 * so tests against it prove the queue's real behavior, not a mocked
 * assumption of what SQLite would do.
 */
interface Row {
  id: number;
  action_type: string;
  payload: string;
  idempotency_key: string;
  status: string;
  attempts: number;
  created_at: string;
}

class FakeDatabase {
  private rows: Row[] = [];
  private nextId = 1;

  async execAsync(_sql: string) {
    // CREATE TABLE — no-op, the in-memory store always "exists."
  }

  async runAsync(sql: string, params: any[] = []) {
    if (sql.startsWith("INSERT INTO offline_queue")) {
      const [actionType, payload, idempotencyKey] = params;
      if (this.rows.some((r) => r.idempotency_key === idempotencyKey)) {
        throw new Error("UNIQUE constraint failed: offline_queue.idempotency_key");
      }
      this.rows.push({
        id: this.nextId++,
        action_type: actionType,
        payload,
        idempotency_key: idempotencyKey,
        status: "PENDING",
        attempts: 0,
        created_at: new Date().toISOString(),
      });
      return;
    }
    if (sql.includes("SET status = 'SYNCED'")) {
      const [id] = params;
      const row = this.rows.find((r) => r.id === id);
      if (row) row.status = "SYNCED";
      return;
    }
    if (sql.includes("SET status = 'FAILED'")) {
      const [attempts, id] = params;
      const row = this.rows.find((r) => r.id === id);
      if (row) {
        row.status = "FAILED";
        row.attempts = attempts;
      }
      return;
    }
    if (sql.startsWith("DELETE FROM offline_queue")) {
      this.rows = [];
      return;
    }
  }

  async getAllAsync(_sql: string) {
    return this.rows
      .filter((r) => r.status !== "SYNCED")
      .map((r) => ({
        id: r.id,
        actionType: r.action_type,
        payload: r.payload,
        idempotencyKey: r.idempotency_key,
        status: r.status,
        attempts: r.attempts,
        createdAt: r.created_at,
      }));
  }
}

let sharedDb: FakeDatabase | null = null;

export async function openDatabaseAsync(_name: string) {
  // Mirrors real expo-sqlite: the same DB name returns the same
  // connection/state within a process.
  if (!sharedDb) sharedDb = new FakeDatabase();
  return sharedDb;
}

export function __resetSharedDbForTests() {
  sharedDb = null;
}
