import express from 'express';
import { protect } from '../middleware/auth';
import {
  scanQR,
  checkIn,
  checkOut,
  getAttendance,
  getMemberHistory,
  checkInByQR,
  getTodayAttendance,
  getAttendanceStats
} from '../controllers/attendanceController';

const router = express.Router();
router.use(protect);

router.get('/',                    getAttendance);
router.get('/today',               getTodayAttendance);
router.get('/stats',               getAttendanceStats);
router.get('/member/:memberId',    getMemberHistory);
router.get('/history/:memberId',   getMemberHistory); // alias
router.post('/scan',               scanQR);
router.post('/checkin',            checkIn);
router.post('/check-in',           checkInByQR);
router.post('/checkout',           checkOut);
router.put('/checkout/:memberId',  checkOut);

export default router;

