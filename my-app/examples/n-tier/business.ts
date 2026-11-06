// #region business
/** What the business tier needs from storage. It knows nothing about SQL. */
export interface AccountRepository {
  /** Runs `work` so that everything inside commits together or not at all. */
  transaction<T>(work: (tx: AccountTx) => Promise<T>): Promise<T>;
}

export interface AccountTx {
  lockBalance(id: string): Promise<number | null>;
  setBalance(id: string, cents: number): Promise<void>;
}

export class InsufficientFunds extends Error {
  constructor() {
    super("insufficient funds");
  }
}

/** Business tier: the rules live here, and they can be tested without a server. */
export class AccountService {
  constructor(private readonly repo: AccountRepository) {}

  transfer(from: string, to: string, cents: number) {
    return this.repo.transaction(async (tx) => {
      // Lock in a fixed order, so two opposite transfers cannot deadlock.
      const [first, second] = [from, to].sort() as [string, string];
      const balances = new Map([
        [first, await tx.lockBalance(first)],
        [second, await tx.lockBalance(second)],
      ]);

      const source = balances.get(from);
      const target = balances.get(to);
      if (source == null || target == null) throw new Error("unknown account");
      if (source < cents) throw new InsufficientFunds();

      await tx.setBalance(from, source - cents);
      await tx.setBalance(to, target + cents);
    });
  }
}
// #endregion
