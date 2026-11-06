import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import type { Pool } from "pg";
import { CircuitBreaker, withRetry } from "./resilience.js";

// #region client
/** Every network call gets a timeout. A call without one can hang forever. */
export function inventoryClient(baseUrl: string, breaker = new CircuitBreaker()) {
  return {
    reserve(quantity: number) {
      // The same key on every retry means the service can spot duplicates.
      const key = randomUUID();
      return withRetry(() =>
        breaker.run(async () => {
          const res = await fetch(`${baseUrl}/reservations`, {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": key },
            body: JSON.stringify({ quantity }),
            signal: AbortSignal.timeout(500),
          });
          if (!res.ok) throw new Error(`inventory responded ${res.status}`);
          return (await res.json()) as { reserved: boolean };
        }),
      );
    },
  };
}
// #endregion

// #region outbox
/**
 * Writing to the database and publishing to a queue are two separate systems,
 * so a crash between them loses the event. The outbox pattern writes the event
 * into the same transaction as the order, then a relay publishes it afterwards.
 */
export async function createOrder(pool: Pool, customer: string, quantity: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: number }>(
      "INSERT INTO orders (customer, quantity) VALUES ($1, $2) RETURNING id",
      [customer, quantity],
    );
    const orderId = rows[0]!.id;
    await client.query("INSERT INTO outbox (topic, payload) VALUES ($1, $2)", [
      "order.created",
      JSON.stringify({ orderId, customer }),
    ]);
    await client.query("COMMIT");
    return orderId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Run this on a timer. SKIP LOCKED lets several relays run side by side. */
export async function relayOutbox(pool: Pool, queue: Queue) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string; topic: string; payload: string }>(
      `SELECT id, topic, payload FROM outbox
       WHERE published_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`,
    );
    for (const row of rows) {
      // The jobId makes a re-publish harmless if we crash before COMMIT.
      await queue.add(row.topic, JSON.parse(row.payload), { jobId: `outbox-${row.id}` });
    }
    await client.query("UPDATE outbox SET published_at = now() WHERE id = ANY($1)", [
      rows.map((r) => r.id),
    ]);
    await client.query("COMMIT");
    return rows.length;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
// #endregion
