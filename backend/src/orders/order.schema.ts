import { z } from 'zod';

export const idempotencyKeySchema = z.string().uuid();

export const createOrderSchema = z.object({
  customerId: z.number().int().positive(),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().positive().max(100),
      }),
    )
    .min(1)
    .max(50),
}).superRefine((value, ctx) => {
  const productIds = new Set<number>();

  for (const item of value.items) {
    if (productIds.has(item.productId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Duplicated products are not allowed',
        path: ['items'],
      });
    }

    productIds.add(item.productId);
  }
});
