import express from 'express';
import { protect } from '../middleware/auth';
import {
  scanQR,
  checkIn,
  checkOut,
  getAttendance,
  getMemberHistory,
  checkInByQR,
} from '../controllers/attendanceController';

const router = express.Router();
router.use(protect);

router.get('/',                    getAttendance);
router.get('/history/:memberId',   getMemberHistory);
router.post('/scan',               scanQR);
router.post('/checkin',            checkIn);
router.post('/check-in',           checkInByQR); // Added for the specific request
router.put('/checkout/:memberId',  checkOut);

export default router;

