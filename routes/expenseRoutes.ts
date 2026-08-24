import express from 'express';
import { protect, adminOnly } from '../middleware/auth';
import {
  createExpense,
  getExpenses,
  getFinancialSummary
} from '../controllers/expenseController';

const router = express.Router();

router.use(protect);

// Financial Security: Admin only
router.post('/', adminOnly, createExpense);
router.get('/', adminOnly, getExpenses);
router.get('/summary', adminOnly, getFinancialSummary);

export default router;
