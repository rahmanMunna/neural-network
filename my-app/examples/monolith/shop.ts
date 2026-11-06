import Fastify from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

// #region checkout
export class OutOfStock extends Error {}

/**
 * The defining advantage of a monolith: stock, order and payment live in one
 * database, so one transaction covers all three. Any failure undoes every step.
 */
export async function checkout(pool: Pool, sku: string, quantity: number, customer: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // The WHERE clause makes this atomic: it cannot take stock that is not there.
    const stock = await client.query(
      `UPDATE products SET stock = stock - $2
       WHERE sku = $1 AND stock >= $2 RETURNING price_cents`,
      [sku, quantity],
    );
    if (stock.rowCount === 0) throw new OutOfStock(sku);

    const total = stock.rows[0].price_cents * quantity;
    const order = await client.query<{ id: number }>(
      "INSERT INTO orders (customer, sku, quantity, total_cents) VALUES ($1, $2, $3, $4) RETURNING id",
      [customer, sku, quantity, total],
    );
    await client.query("INSERT INTO payments (order_id, cents) VALUES ($1, $2)", [order.rows[0]!.id, total]);

    await client.query("COMMIT");
    return { orderId: order.rows[0]!.id, total };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
// #endregion

// #region route
export function buildShop(pool: Pool) {
  const app = Fastify();

  app.post("/checkout", async (req, reply) => {
    const body = z
      .object({ sku: z.string(), quantity: z.number().int().positive(), customer: z.string() })
      .parse(req.body);
    try {
      return await checkout(pool, body.sku, body.quantity, body.customer);
    } catch (err) {
      if (err instanceof OutOfStock) return reply.code(409).send({ error: "out of stock" });
      throw err;
    }
  });

  return app;
}
// #endregion
