import express from 'express';
import { protect, adminOnly } from '../middleware/auth';
import {
  getTransactions,
  getTransactionsDashboard
} from '../controllers/transactionController';

const router = express.Router();

router.use(protect);
router.use(adminOnly); // Dashboard and Transactions listing is financial/admin only

router.get('/', getTransactions);
router.get('/dashboard', getTransactionsDashboard);

export default router;
