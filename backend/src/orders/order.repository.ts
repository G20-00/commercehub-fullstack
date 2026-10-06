import type { PoolClient } from 'pg';
import type {
  CreateOrderInput,
  CreateOrderResponse,
  IdempotencyRecord,
  OrderRow,
  ProductForOrder,
} from './order.types';

export async function findIdempotencyKey(
  client: PoolClient,
  key: string,
): Promise<IdempotencyRecord | null> {
  const result = await client.query<IdempotencyRecord>(
    `SELECT key, request_hash, order_id, response_status, response_body
     FROM idempotency_keys
     WHERE key = $1`,
    [key],
  );

  return result.rows[0] ?? null;
}

export async function createIdempotencyKey(
  client: PoolClient,
  key: string,
  requestHash: string,
): Promise<void> {
  await client.query(
    `INSERT INTO idempotency_keys (key, request_hash)
     VALUES ($1, $2)`,
    [key, requestHash],
  );
}

export async function updateIdempotencyResult(
  client: PoolClient,
  key: string,
  orderId: number,
  responseStatus: number,
  responseBody: CreateOrderResponse,
): Promise<void> {
  await client.query(
    `UPDATE idempotency_keys
     SET order_id = $2, response_status = $3, response_body = $4
     WHERE key = $1`,
    [key, orderId, responseStatus, responseBody],
  );
}

export async function findProductsByIds(
  client: PoolClient,
  productIds: number[],
): Promise<ProductForOrder[]> {
  const result = await client.query<ProductForOrder>(
    `SELECT id, name, price, active
     FROM products
     WHERE id = ANY($1::bigint[])`,
    [productIds],
  );

  return result.rows;
}

export async function reserveInventory(
  client: PoolClient,
  productId: number,
  quantity: number,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE inventory
     SET available_quantity = available_quantity - $2,
         updated_at = NOW()
     WHERE product_id = $1
       AND available_quantity >= $2
     RETURNING product_id`,
    [productId, quantity],
  );

  return result.rowCount === 1;
}

export async function insertOrder(
  client: PoolClient,
  customerId: number,
  totalAmount: string,
): Promise<OrderRow> {
  const result = await client.query<OrderRow>(
    `INSERT INTO orders (customer_id, status, total_amount)
     VALUES ($1, 'PENDING_PAYMENT', $2)
     RETURNING id, customer_id, status, total_amount, created_at`,
    [customerId, totalAmount],
  );

  return result.rows[0];
}

export async function insertOrderItems(
  client: PoolClient,
  orderId: number,
  input: CreateOrderInput,
  productsById: Map<number, ProductForOrder>,
): Promise<void> {
  const values: Array<number | string> = [];
  const placeholders = input.items.map((item, index) => {
    const product = productsById.get(item.productId);
    const base = index * 4;

    values.push(orderId, item.productId, item.quantity, product?.price ?? '0');

    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
  });

  await client.query(
    `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
     VALUES ${placeholders.join(', ')}`,
    values,
  );
}

export async function insertInventoryReservations(
  client: PoolClient,
  orderId: number,
  input: CreateOrderInput,
): Promise<void> {
  const values: number[] = [];
  const placeholders = input.items.map((item, index) => {
    const base = index * 3;

    values.push(orderId, item.productId, item.quantity);

    return `($${base + 1}, $${base + 2}, $${base + 3}, 'ACTIVE', NOW() + INTERVAL '15 minutes')`;
  });

  await client.query(
    `INSERT INTO inventory_reservations (
       order_id, product_id, quantity, status, expires_at
     )
     VALUES ${placeholders.join(', ')}`,
    values,
  );
}

export async function insertPendingPayment(
  client: PoolClient,
  orderId: number,
  amount: string,
): Promise<void> {
  await client.query(
    `INSERT INTO payments (order_id, status, provider, amount)
     VALUES ($1, 'PENDING', 'external_provider', $2)`,
    [orderId, amount],
  );
}

export async function updatePaymentProviderReference(
  client: PoolClient,
  orderId: number,
  providerPaymentId: string,
): Promise<void> {
  await client.query(
    `UPDATE payments
     SET provider_payment_id = $2, updated_at = NOW()
     WHERE order_id = $1`,
    [orderId, providerPaymentId],
  );
}
