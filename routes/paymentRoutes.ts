import express from 'express';
import { protect, adminOnly } from '../middleware/auth';
import {
  createPayment,
  getPayments,
  getRevenueDashboard,
  payRemaining
} from '../controllers/paymentController';

const router = express.Router();

router.use(protect);

// Financial Security: Admin only for listing all payments and manual payment creation
router.post('/', adminOnly, createPayment);
router.post('/:id/pay-remaining', payRemaining);
router.get('/', adminOnly, getPayments);
router.get('/dashboard', getRevenueDashboard);

export default router;
