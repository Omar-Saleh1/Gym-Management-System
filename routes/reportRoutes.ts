import express from 'express';
import { protect } from '../middleware/auth';
import {
  getDashboard,
  getSalesReport,
  getSubscriptionsReport,
  getAttendanceReport,
  getDailyFinancialReport,
  getMonthlyReport,
  getDailyReport,
} from '../controllers/reportController';

const router = express.Router();
router.use(protect);

router.get('/dashboard', getDashboard);
router.get('/sales', getSalesReport);
router.get('/subscriptions', getSubscriptionsReport);
router.get('/attendance', getAttendanceReport);
router.get('/daily-financial', getDailyFinancialReport);
router.get('/monthly', getMonthlyReport);
router.get('/daily', getDailyReport);

export default router;
