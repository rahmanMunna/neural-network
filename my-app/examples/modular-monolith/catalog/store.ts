// Private to the catalog module. In production this is the module's own tables.
interface Product {
  sku: string;
  stock: number;
  price: number;
}

export function createCatalogStore() {
  const products = new Map<string, Product>([["kb", { sku: "kb", stock: 3, price: 2000 }]]);
  return { find: (sku: string) => products.get(sku) };
}
