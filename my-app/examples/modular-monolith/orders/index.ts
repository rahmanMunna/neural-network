import type { CatalogApi } from "../catalog/index.js";
import type { EventBus } from "../events.js";

// #region orders
export interface OrdersApi {
  place(customer: string, sku: string, quantity: number): Promise<{ orderId: number } | null>;
}

/** Orders receives the catalog's public API. It never touches catalog tables. */
export function createOrders(deps: { catalog: CatalogApi; bus: EventBus }): OrdersApi {
  let nextId = 1;
  return {
    async place(customer, sku, quantity) {
      const reservation = deps.catalog.reserve(sku, quantity);
      if (!reservation) return null;

      const orderId = nextId++;
      const total = reservation.unitPrice * quantity;
      // Orders does not know notifications exists. It only states what happened.
      await deps.bus.publish("order.placed", { orderId, customer, total });
      return { orderId };
    },
  };
}
// #endregion
