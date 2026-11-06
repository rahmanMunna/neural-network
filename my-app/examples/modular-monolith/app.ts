// #region compose
import { createCatalog } from "./catalog/index.js";
import { EventBus } from "./events.js";
import { registerNotifications } from "./notifications/index.js";
import { createOrders } from "./orders/index.js";

/** The one place that knows every module. Dependencies are wired explicitly. */
export function createApp(send: (to: string, text: string) => void) {
  const bus = new EventBus();
  const catalog = createCatalog();
  const orders = createOrders({ catalog, bus });
  registerNotifications(bus, send);
  return { catalog, orders };
}
// #endregion
