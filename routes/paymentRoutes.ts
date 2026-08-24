import express from 'express';
import { protect, adminOnly } from '../middleware/auth';
import {
  createPayment,
  getPayments,
  getRevenueDashboard
} from '../controllers/paymentController';

const router = express.Router();

router.use(protect);

// Financial Security: Admin only
router.post('/', adminOnly, createPayment);
router.get('/', adminOnly, getPayments);
router.get('/dashboard', adminOnly, getRevenueDashboard);

export default router;
