import ordersData from "../data/koch-orders.json";

/** Koch character orders (SPEC §7.1). Sources are recorded in src/data/README.md. */

export type KochOrderId = "lcwo" | "g4fon" | "classic-v1";

export interface KochOrder {
  readonly id: KochOrderId;
  readonly name: string;
  readonly chars: readonly string[];
}

export const DEFAULT_KOCH_ORDER: KochOrderId = "lcwo";

export const KOCH_ORDERS: readonly KochOrder[] = ordersData.items.map((o) => ({
  id: o.id as KochOrderId,
  name: o.name,
  chars: o.chars,
}));

export function kochOrder(id: KochOrderId): KochOrder {
  const order = KOCH_ORDERS.find((o) => o.id === id);
  if (!order) throw new Error(`Unknown Koch order: ${id}`);
  return order;
}

/** Highest level for an order: every character learned. */
export function maxKochLevel(order: KochOrder): number {
  return order.chars.length - 1;
}

/** Level N means the first N+1 characters; level 1 is K and M (as in v1). */
export function kochChars(order: KochOrder, level: number): readonly string[] {
  if (!Number.isInteger(level) || level < 1 || level > maxKochLevel(order)) {
    throw new RangeError(`Koch level must be within 1–${maxKochLevel(order)}, got ${level}`);
  }
  return order.chars.slice(0, level + 1);
}

/** The character introduced at this level. */
export function newestKochChar(order: KochOrder, level: number): string {
  return kochChars(order, level)[level] as string;
}
