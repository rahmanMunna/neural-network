import type { Pool } from "pg";
import type { AccountRepository, AccountTx } from "./business.js";

// #region data
/** Data tier: the only place that knows tables and SQL. */
export class PgAccountRepository implements AccountRepository {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(work: (tx: AccountTx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work({
        async lockBalance(id) {
          // FOR UPDATE holds the row until COMMIT, so a concurrent transfer
          // waits here instead of reading a balance that is about to change.
          const { rows } = await client.query<{ cents: string }>(
            "SELECT cents FROM accounts WHERE id = $1 FOR UPDATE",
            [id],
          );
          return rows[0] ? Number(rows[0].cents) : null;
        },
        async setBalance(id, cents) {
          await client.query("UPDATE accounts SET cents = $2 WHERE id = $1", [id, cents]);
        },
      });
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      // Always return the connection, or the pool slowly runs dry.
      client.release();
    }
  }
}
// #endregion
