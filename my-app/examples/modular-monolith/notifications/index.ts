import type { EventBus } from "../events.js";

// #region notifications
/** Reacts to events, and exports nothing that other modules need to call. */
export function registerNotifications(bus: EventBus, send: (to: string, text: string) => void) {
  bus.on("order.placed", ({ orderId, customer }) => {
    send(customer, `Order ${orderId} confirmed`);
  });
}
// #endregion
