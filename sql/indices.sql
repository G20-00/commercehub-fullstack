CREATE INDEX idx_orders_customer_id_created_at
ON orders (customer_id, created_at DESC);

CREATE INDEX idx_order_items_order_id
ON order_items (order_id);

CREATE INDEX idx_payments_order_id
ON payments (order_id);

CREATE INDEX idx_inventory_reservations_order_id
ON inventory_reservations (order_id);

CREATE INDEX idx_inventory_reservations_expires_at
ON inventory_reservations (expires_at)
WHERE status = 'ACTIVE';
