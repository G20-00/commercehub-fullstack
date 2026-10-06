export interface CreateOrderItemInput {
  productId: number;
  quantity: number;
}

export interface CreateOrderInput {
  customerId: number;
  items: CreateOrderItemInput[];
}

export interface ProductForOrder {
  id: number;
  name: string;
  price: string;
  active: boolean;
}

export interface OrderRow {
  id: number;
  customer_id: number;
  status: string;
  total_amount: string;
  created_at: Date;
}

export interface IdempotencyRecord {
  key: string;
  request_hash: string;
  order_id: number | null;
  response_status: number | null;
  response_body: unknown | null;
}

export interface CreateOrderResponse {
  orderId: number;
  status: string;
  totalAmount: string;
  items: Array<{
    productId: number;
    quantity: number;
    unitPrice: string;
  }>;
}

export interface CreateOrderResult {
  statusCode: number;
  body: CreateOrderResponse;
  replayed: boolean;
}
