import express from 'express';
import { orderRouter } from './orders/order.controller';

export const app = express();

app.use(express.json());
app.use(orderRouter);

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});
