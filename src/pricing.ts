export interface LineItem {
  description: string;
  quantity: number;
  unit: string;
  unit_price_pence: number;
  /** Set when the price came from the price list; null for a custom line. */
  price_item_id: number | null;
  /** True when someone must check the line before the quote goes out. */
  needs_review: boolean;
  review_reason: string;
}

export interface PriceItem {
  id: number;
  name: string;
  category: string;
  unit: string;
  price_pence: number;
  notes: string;
  active: number;
}

export interface Totals {
  subtotal_pence: number;
  vat_pence: number;
  total_pence: number;
  deposit_pence: number;
}

export function computeTotals(
  items: LineItem[],
  discountPence: number,
  vatRatePercent: number,
  depositPercent: number,
  /** A fixed deposit (e.g. £50 to secure a date); when set it replaces the percentage. */
  depositFixedPence: number | null = null,
): Totals {
  const lines = items.reduce((sum, item) => sum + Math.round(item.quantity * item.unit_price_pence), 0);
  const subtotal = Math.max(0, lines - Math.max(0, discountPence));
  const vat = Math.round((subtotal * vatRatePercent) / 100);
  const total = subtotal + vat;
  return {
    subtotal_pence: subtotal,
    vat_pence: vat,
    total_pence: total,
    deposit_pence:
      depositFixedPence !== null ? Math.min(depositFixedPence, total) : Math.round((total * depositPercent) / 100),
  };
}

/** Coerces untrusted JSON (from the browser or the model) into well-formed line items. */
export function sanitiseLineItems(value: unknown): LineItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const quantity = Number(item.quantity);
    const price = Number(item.unit_price_pence);
    const priceItemId = Number(item.price_item_id);
    return {
      description: String(item.description ?? '').slice(0, 500),
      quantity: Number.isFinite(quantity) ? quantity : 0,
      unit: String(item.unit ?? '').slice(0, 50),
      unit_price_pence: Number.isFinite(price) ? Math.round(price) : 0,
      price_item_id: Number.isInteger(priceItemId) && priceItemId > 0 ? priceItemId : null,
      needs_review: Boolean(item.needs_review),
      review_reason: String(item.review_reason ?? '').slice(0, 500),
    };
  });
}

/**
 * Replaces each price-list line's price with the one in the price list, so a quote
 * can never carry a price the model made up. Lines pointing at an unknown or inactive
 * item become custom lines that need review.
 */
export function applyPriceList(items: LineItem[], priceList: PriceItem[]): LineItem[] {
  const byId = new Map(priceList.filter((p) => p.active).map((p) => [p.id, p]));
  return items.map((item) => {
    if (item.price_item_id === null) {
      return {
        ...item,
        needs_review: true,
        review_reason: item.review_reason || 'Not on the price list: check the price.',
      };
    }
    const priced = byId.get(item.price_item_id);
    if (!priced) {
      return {
        ...item,
        price_item_id: null,
        needs_review: true,
        review_reason: 'Referred to a price list item that no longer exists: check the price.',
      };
    }
    return { ...item, unit_price_pence: priced.price_pence, unit: item.unit || priced.unit };
  });
}
