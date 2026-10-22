import { z } from 'zod';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// Control totals are the "expected" side of reconciliation. For real data they would come
// from an SAP summary report; for synthetic data they come from the independent generator.
export const controlTotalsSchema = z
  .object({
  schemaVersion: z.literal(1),
  synthetic: z.boolean(),
  totals: z
    .array(
      z.object({
        month: z.string().regex(MONTH),
        currency: z.string().regex(/^[A-Z]{3}$/),
        netAmount: z.string().regex(/^-?\d{1,16}(\.\d{1,2})?$/),
        lineCount: z.number().int().nonnegative(),
      }),
    )
    .min(1),
  quantityTotals: z.array(
    z.object({
      month: z.string().regex(MONTH),
      unit: z.string().regex(/^[A-Z0-9]{1,10}$/),
      quantity: z.string().regex(/^-?\d{1,16}(\.\d{1,3})?$/),
    }),
  ),
  })
  .superRefine((ct, ctx) => {
    const dup = (keys: string[]) => keys.find((k, i) => keys.indexOf(k) !== i);
    const t = dup(ct.totals.map((x) => `${x.month}|${x.currency}`));
    if (t) ctx.addIssue({ code: 'custom', message: `Duplicate totals entry ${t}` });
    const q = dup(ct.quantityTotals.map((x) => `${x.month}|${x.unit}`));
    if (q) ctx.addIssue({ code: 'custom', message: `Duplicate quantityTotals entry ${q}` });
  });

export type ControlTotals = z.infer<typeof controlTotalsSchema>;
