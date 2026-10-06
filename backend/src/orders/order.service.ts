import { createHash } from 'crypto';
import { pool } from '../database/pool';
import {
  IdempotencyConflictError,
  InsufficientStockError,
  ProductNotAvailableError,
  ProductNotFoundError,
} from './order.errors';
import { paymentProvider } from './payment-provider';
import {
  createIdempotencyKey,
  findIdempotencyKey,
  findProductsByIds,
  insertInventoryReservations,
  insertOrder,
  insertOrderItems,
  insertPendingPayment,
  reserveInventory,
  updateIdempotencyResult,
  updatePaymentProviderReference,
} from './order.repository';
import type {
  CreateOrderInput,
  CreateOrderResponse,
  CreateOrderResult,
  ProductForOrder,
} from './order.types';

function normalizeOrderPayload(input: CreateOrderInput): CreateOrderInput {
  return {
    customerId: input.customerId,
    items: [...input.items].sort((a, b) => a.productId - b.productId),
  };
}

function createRequestHash(input: CreateOrderInput): string {
  return createHash('sha256')
    .update(JSON.stringify(normalizeOrderPayload(input)))
    .digest('hex');
}

function isIdempotencyUniqueViolation(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === '23505'
    && 'constraint' in error
    && error.constraint === 'uq_idempotency_keys_key';
}

function calculateTotalAmount(
  input: CreateOrderInput,
  productsById: Map<number, ProductForOrder>,
): string {
  const totalCents = input.items.reduce((sum, item) => {
    const product = productsById.get(item.productId);
    const unitPriceCents = parseMoneyToCents(product?.price ?? '0.00');

    return sum + BigInt(item.quantity) * unitPriceCents;
  }, 0n);

  return formatCents(totalCents);
}

function parseMoneyToCents(value: string): bigint {
  const [units, decimals = ''] = value.split('.');
  const normalizedDecimals = decimals.padEnd(2, '0').slice(0, 2);

  return BigInt(units) * 100n + BigInt(normalizedDecimals);
}

function formatCents(value: bigint): string {
  const units = value / 100n;
  const cents = value % 100n;

  return `${units}.${cents.toString().padStart(2, '0')}`;
}

function buildResponse(
  orderId: number,
  status: string,
  totalAmount: string,
  input: CreateOrderInput,
  productsById: Map<number, ProductForOrder>,
): CreateOrderResponse {
  return {
    orderId,
    status,
    totalAmount,
    items: input.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: productsById.get(item.productId)?.price ?? '0.00',
    })),
  };
}

async function replayExistingOrder(
  idempotencyKey: string,
  requestHash: string,
): Promise<CreateOrderResult | null> {
  const client = await pool.connect();

  try {
    const existing = await findIdempotencyKey(client, idempotencyKey);

    if (!existing) {
      return null;
    }

    if (existing.request_hash !== requestHash) {
      throw new IdempotencyConflictError();
    }

    if (existing.response_status && existing.response_body) {
      return {
        statusCode: 200,
        body: existing.response_body as CreateOrderResponse,
        replayed: true,
      };
    }

    return null;
  } finally {
    client.release();
  }
}

export async function createOrder(
  input: CreateOrderInput,
  idempotencyKey: string,
): Promise<CreateOrderResult> {
  const requestHash = createRequestHash(input);
  const existing = await replayExistingOrder(idempotencyKey, requestHash);

  if (existing) {
    return existing;
  }

  const client = await pool.connect();
  let responseBody: CreateOrderResponse;

  try {
    await client.query('BEGIN');
    await createIdempotencyKey(client, idempotencyKey, requestHash);

    const productIds = input.items.map((item) => item.productId);
    const products = await findProductsByIds(client, productIds);

    if (products.length !== productIds.length) {
      throw new ProductNotFoundError();
    }

    const productsById = new Map(products.map((product) => [product.id, product]));

    if (products.some((product) => !product.active)) {
      throw new ProductNotAvailableError();
    }

    const itemsToReserve = [...input.items].sort((a, b) => a.productId - b.productId);

    for (const item of itemsToReserve) {
      const reserved = await reserveInventory(client, item.productId, item.quantity);

      if (!reserved) {
        throw new InsufficientStockError();
      }
    }

    const totalAmount = calculateTotalAmount(input, productsById);
    const order = await insertOrder(client, input.customerId, totalAmount);

    await insertOrderItems(client, order.id, input, productsById);
    await insertInventoryReservations(client, order.id, input);
    await insertPendingPayment(client, order.id, totalAmount);

    responseBody = buildResponse(order.id, order.status, totalAmount, input, productsById);

    await updateIdempotencyResult(client, idempotencyKey, order.id, 201, responseBody);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');

    if (isIdempotencyUniqueViolation(error)) {
      const replayed = await replayExistingOrder(idempotencyKey, requestHash);

      if (replayed) {
        return replayed;
      }
    }

    throw error;
  } finally {
    client.release();
  }

  try {
    const payment = await paymentProvider.createPayment({
      orderId: responseBody.orderId,
      amount: responseBody.totalAmount,
      idempotencyKey,
    });

    const paymentClient = await pool.connect();

    try {
      await updatePaymentProviderReference(
        paymentClient,
        responseBody.orderId,
        payment.providerPaymentId,
      );
    } finally {
      paymentClient.release();
    }
  } catch {
    return {
      statusCode: 201,
      body: responseBody,
      replayed: false,
    };
  }

  return {
    statusCode: 201,
    body: responseBody,
    replayed: false,
  };
}
