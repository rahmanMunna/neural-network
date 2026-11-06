import { redis } from "./client.js";
import { cachedOnce, safely } from "./cache.js";

export interface User {
  id: number;
  name: string;
}

/** The two database calls this module needs. Your real data layer goes here. */
export interface UserStore {
  find(id: number): Promise<User | null>;
  rename(id: number, name: string): Promise<User | null>;
}

// #region usage
const userKey = (id: number) => `user:${id}`;

export function userService(db: UserStore) {
  return {
    get: (id: number) => cachedOnce(userKey(id), 60, () => db.find(id)),

    async rename(id: number, name: string) {
      // Write to the database first. It is the source of truth.
      const user = await db.rename(id, name);
      // Then delete the key, rather than updating it. Two concurrent writers
      // could otherwise leave the older value in the cache. If Redis is down the
      // write still succeeds, and the short TTL limits how long stale data lasts.
      await safely(() => redis.del(userKey(id)));
      return user;
    },
  };
}
// #endregion
