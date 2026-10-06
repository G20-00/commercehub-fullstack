export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) { super(message); }
}

export class MissingIdempotencyKeyError extends AppError {
  constructor() { super('MISSING_IDEMPOTENCY_KEY', 'Missing Idempotency-Key header', 400); }
}

export class IdempotencyConflictError extends AppError {
  constructor() { super('IDEMPOTENCY_CONFLICT', 'Idempotency-Key was used with a different payload', 409); }
}

export class ProductNotFoundError extends AppError {
  constructor() { super('PRODUCT_NOT_FOUND', 'One or more products do not exist', 422); }
}

export class ProductNotAvailableError extends AppError {
  constructor() { super('PRODUCT_NOT_AVAILABLE', 'One or more products are not available', 422); }
}

export class InsufficientStockError extends AppError {
  constructor() { super('INSUFFICIENT_STOCK', 'Insufficient stock for one or more products', 422); }
}
