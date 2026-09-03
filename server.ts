import 'dotenv/config';
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import connectDB from './config/db';
import { initScheduler } from './services/scheduler.service';
import { initWhatsAppClient } from './services/whatsapp.service';

import authRoutes          from './routes/authRoutes';
import memberRoutes        from './routes/memberRoutes';
import subscriptionRoutes  from './routes/subscriptionRoutes';
import productRoutes       from './routes/productRoutes';
import saleRoutes          from './routes/saleRoutes';
import attendanceRoutes    from './routes/attendanceRoutes';
import reportRoutes        from './routes/reportRoutes';
import notificationRoutes  from './routes/notificationRoutes';
import whatsappRoutes      from './routes/whatsappRoutes';
import paymentRoutes       from './routes/paymentRoutes';
import expenseRoutes       from './routes/expenseRoutes';
import workoutRoutes       from './routes/workoutRoutes';
import dietRoutes          from './routes/dietRoutes';
import coachRoutes         from './routes/coachRoutes';
import transactionRoutes   from './routes/transactionRoutes';
import singleVisitRoutes   from './routes/singleVisitRoutes';

const app: Application = express();

connectDB();

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.get('/', (req: Request, res: Response) =>
  res.json({ status: 'Gym System API is running ✅ (TypeScript)' })
);

app.use('/api/auth',          authRoutes);
app.use('/api/members',       memberRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/products',      productRoutes);
app.use('/api/sales',         saleRoutes);
app.use('/api/attendance',    attendanceRoutes);
app.use('/api/reports',       reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/whatsapp',      whatsappRoutes);
app.use('/api/payments',      paymentRoutes);
app.use('/api/expenses',      expenseRoutes);
app.use('/api/workout-plans', workoutRoutes);
app.use('/api/diet-plans',    dietRoutes);
app.use('/api/coaches',       coachRoutes);
app.use('/api/transactions',  transactionRoutes);
app.use('/api/single-visits', singleVisitRoutes);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ message: 'حصل خطأ في السيرفر' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  initScheduler();         // start daily cron jobs
  // Fire-and-forget — WhatsApp init is async and must not block HTTP or crash the server
  try {
    initWhatsAppClient();
  } catch (err) {
    console.error('[WhatsApp] Failed to start client bootstrap:', err);
  }
});
