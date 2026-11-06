// #region catalog-public
// modules/catalog/index.ts is the module's only public door.
// Other modules may import this file and nothing else inside the folder.
import { createCatalogStore } from "./store.js";

export interface CatalogApi {
  reserve(sku: string, quantity: number): { unitPrice: number } | null;
  stockOf(sku: string): number;
}

export function createCatalog(): CatalogApi {
  const store = createCatalogStore();
  return {
    reserve(sku, quantity) {
      const product = store.find(sku);
      if (!product || product.stock < quantity) return null;
      product.stock -= quantity;
      return { unitPrice: product.price };
    },
    stockOf: (sku) => store.find(sku)?.stock ?? 0,
  };
}
// #endregion
