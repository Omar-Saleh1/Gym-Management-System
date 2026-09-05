import express from 'express';
import { protect } from '../middleware/auth';
import {
  createExpense,
  getExpenses,
  deleteExpense,
  getFinancialSummary
} from '../controllers/expenseController';

const router = express.Router();

router.use(protect);

// Allow cashiers in any shift to record and view expenses
router.post('/', createExpense);
router.get('/', getExpenses);
router.delete('/:id', deleteExpense);
router.get('/summary', getFinancialSummary);

export default router;
