import { Decimal } from 'decimal.js';

// Documented SAP SD billing-type rules (see docs/ARCHITECTURE.md, "Sign rules").
// SAP billing exports show values unsigned; the billing type decides the direction.
//
// | Type | Meaning                   | Net amount | Units sold        |
// |------|---------------------------|------------|-------------------|
// | F2   | Invoice                   | +value     | +quantity         |
// | G2   | Credit memo (price/value) | -value     | 0 (no goods move) |
// | RE   | Returns credit            | -value     | -quantity         |
// | S1   | Cancellation of invoice   | -value     | -quantity         |
//
// Any other billing type is rejected rather than guessed.
export const BILLING_TYPES = ['F2', 'G2', 'RE', 'S1'] as const;
export type SupportedBillingType = (typeof BILLING_TYPES)[number];

const RULES: Record<SupportedBillingType, { amountSign: 1 | -1; quantitySign: 1 | 0 | -1 }> = {
  F2: { amountSign: 1, quantitySign: 1 },
  G2: { amountSign: -1, quantitySign: 0 },
  RE: { amountSign: -1, quantitySign: -1 },
  S1: { amountSign: -1, quantitySign: -1 },
};

export function isSupportedBillingType(v: string): v is SupportedBillingType {
  return (BILLING_TYPES as readonly string[]).includes(v);
}

/** Applies the sign rule. Inputs are unsigned canonical decimal strings. */
export function applySignRules(
  type: SupportedBillingType,
  unsignedAmount: string,
  unsignedQuantity: string,
): { netAmount: string; quantity: string } {
  const rule = RULES[type];
  const amount = new Decimal(unsignedAmount).times(rule.amountSign);
  const quantity = new Decimal(unsignedQuantity).times(rule.quantitySign);
  // Decimal keeps "-0"; normalize so 0 is always "0.00"/"0.000".
  return {
    netAmount: (amount.isZero() ? new Decimal(0) : amount).toFixed(2),
    quantity: (quantity.isZero() ? new Decimal(0) : quantity).toFixed(3),
  };
}
