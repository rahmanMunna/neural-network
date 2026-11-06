// #region events
/** Every event modules may publish. This list is part of the public contract. */
export interface DomainEvents {
  "order.placed": { orderId: number; customer: string; total: number };
}

type Handler<K extends keyof DomainEvents> = (event: DomainEvents[K]) => Promise<void> | void;

/**
 * Modules announce facts without knowing who listens. This bus runs in-process,
 * so splitting a module out later means replacing only this file with a queue.
 */
export class EventBus {
  private handlers = new Map<keyof DomainEvents, Handler<never>[]>();

  on<K extends keyof DomainEvents>(name: K, handler: Handler<K>) {
    const list = this.handlers.get(name) ?? [];
    list.push(handler as Handler<never>);
    this.handlers.set(name, list);
  }

  async publish<K extends keyof DomainEvents>(name: K, event: DomainEvents[K]) {
    for (const handler of this.handlers.get(name) ?? []) {
      await (handler as Handler<K>)(event);
    }
  }
}
// #endregion
