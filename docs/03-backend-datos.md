# 3. Backend y datos

## 3.1 Endpoint

Endpoint principal:

```http
POST /api/v1/orders
Idempotency-Key: 1c12d63b-7b20-4d7c-a508-c349478f2310
Content-Type: application/json
```

Body esperado:

```json
{
  "customerId": 123,
  "items": [
    { "productId": 10, "quantity": 2 },
    { "productId": 15, "quantity": 1 }
  ]
}
```

El frontend no envia precios ni stock
El backend toma los precios vigentes desde PostgreSQL

## 3.2 Validacion

Se valida con Zod:

```ts
export const createOrderSchema = z.object({
  customerId: z.number().int().positive(),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().int().positive().max(100),
  })).min(1).max(50),
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
```

Idempotency-Key tambien se valida
En el ejemplo se usa UUID

## 3.3 Flujo de creacion

Flujo resumido:

```text
validar request
validar Idempotency-Key
calcular request_hash
buscar replay idempotente
BEGIN
  insertar Idempotency-Key
  cargar productos y precios
  reservar inventario
  crear orden
  crear items
  crear reservas
  crear pago pendiente
  guardar respuesta idempotente
COMMIT
llamar proveedor de pagos
```

La llamada al proveedor ocurre despues del COMMIT
No se mantiene una transaccion abierta esperando una respuesta externa

## 3.4 Transaccion y concurrencia

La transaccion usa un cliente dedicado de pg
Si falla cualquier parte, se hace rollback

Los productos se consultan en lote:

```sql
SELECT id, name, price, active
FROM products
WHERE id = ANY($1::bigint[]);
```

Antes de reservar inventario, los items se ordenan por productId
Esto reduce posibilidades de deadlock cuando dos ordenes toman varios productos

```ts
const itemsToReserve = [...input.items].sort(
  (a, b) => a.productId - b.productId,
);
```

## 3.5 Idempotencia

El SELECT inicial es solo una optimizacion
La garantia real es la restriccion UNIQUE en PostgreSQL

```sql
key UUID NOT NULL CONSTRAINT uq_idempotency_keys_key UNIQUE
```

Caso concurrente:

```text
Request A y B llegan con la misma key
ambos pueden no encontrarla inicialmente
A inserta la key
B falla por UNIQUE 23505
B consulta la operacion existente
mismo hash -> replay
hash distinto -> 409
```

El payload se normaliza y se calcula SHA-256
Si la misma key llega con payload diferente, se responde 409 Conflict

No se usan locks en memoria
No se usa Redis para idempotencia critica

## 3.6 Inventario

PostgreSQL es la fuente de verdad del inventario
Al reservar se decrementa available_quantity

Operacion atomica:

```sql
UPDATE inventory
SET available_quantity = available_quantity - $2,
    updated_at = NOW()
WHERE product_id = $1
  AND available_quantity >= $2
RETURNING product_id;
```

Si no retorna fila, no habia stock suficiente
La transaccion completa hace rollback
No se crea una orden parcial

Tambien se guarda una reserva con:

```text
order_id
product_id
quantity
status
expires_at
```

Si el pago falla definitivamente o la reserva expira, se devuelve el inventario

## 3.7 Pago externo

El pago se crea despues del COMMIT:

```ts
await paymentProvider.createPayment({
  orderId,
  amount,
  idempotencyKey,
});
```

Si hay timeout o error de comunicacion, no se marca automaticamente como PAYMENT_FAILED
El proveedor pudo haber procesado el pago
La orden puede quedar en PENDING_PAYMENT

Luego se resuelve con:

- retry idempotente
- webhook
- reconciliacion
- expiracion de reserva

Los webhooks duplicados se manejan guardando provider_event_id con UNIQUE
Si el evento ya existe, no se vuelven a aplicar cambios

## 3.8 Modelo de datos

Tablas usadas:

- products
- inventory
- orders
- order_items
- inventory_reservations
- payments
- idempotency_keys
- payment_webhook_events

Campos importantes:

```text
orders: customer_id, status, total_amount
order_items: order_id, product_id, quantity, unit_price
inventory: product_id, available_quantity
payments: order_id, status, provider_payment_id, amount
idempotency_keys: key, request_hash, order_id, response_status, response_body
```

El precio queda copiado en order_items.unit_price
No se reconstruye una compra historica usando el precio actual del producto

Para dinero se usa NUMERIC(12, 2)
No se usa float

## 3.9 Indices

Indices principales:

```sql
CREATE INDEX idx_orders_customer_id_created_at
ON orders (customer_id, created_at DESC);

CREATE INDEX idx_order_items_order_id
ON order_items (order_id);

CREATE INDEX idx_payments_order_id
ON payments (order_id);

CREATE INDEX idx_inventory_reservations_expires_at
ON inventory_reservations (expires_at)
WHERE status = 'ACTIVE';
```

No se agregan indices extra sobre PRIMARY KEY o UNIQUE
PostgreSQL ya los crea

## 3.10 Errores HTTP

201 Created:
orden creada por primera vez

200 OK:
replay idempotente con misma key y mismo payload

400 Bad Request:
body invalido o Idempotency-Key faltante/invalida

409 Conflict:
misma Idempotency-Key con payload diferente

422 Unprocessable Entity:
producto inexistente, producto inactivo o stock insuficiente

500 Internal Server Error:
error inesperado

Formato usado:

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Insufficient stock for one or more products"
  }
}
```
