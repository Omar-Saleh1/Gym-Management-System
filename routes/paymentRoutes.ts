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

// Financial Security: Admin only (except pay-remaining which all cashiers can use)
router.post('/', adminOnly, createPayment);
router.post('/:id/pay-remaining', payRemaining);
router.get('/', adminOnly, getPayments);
router.get('/dashboard', adminOnly, getRevenueDashboard);

export default router;
