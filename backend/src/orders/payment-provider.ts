export interface CreatePaymentInput {
  orderId: number;
  amount: string;
  idempotencyKey: string;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
}

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
}

export const paymentProvider: PaymentProvider = {
  async createPayment(input) {
    return { providerPaymentId: `provider-${input.orderId}` };
  },
};
