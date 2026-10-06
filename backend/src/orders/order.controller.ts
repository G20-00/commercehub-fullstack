import { Router } from 'express';
import { z } from 'zod';
import { AppError, MissingIdempotencyKeyError } from './order.errors';
import { createOrderSchema, idempotencyKeySchema } from './order.schema';
import { createOrder } from './order.service';

export const orderRouter = Router();

orderRouter.post('/api/v1/orders', async (req, res) => {
  try {
    const idempotencyKeyHeader = req.header('Idempotency-Key');

    if (!idempotencyKeyHeader) {
      throw new MissingIdempotencyKeyError();
    }

    const idempotencyKey = idempotencyKeySchema.parse(idempotencyKeyHeader);
    const input = createOrderSchema.parse(req.body);
    const result = await createOrder(input, idempotencyKey);

    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
        },
      });
    }

    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected error',
      },
    });
  }
});
