import express from 'express';
import { protect, adminOnly } from '../middleware/auth';
import {
  login,
  register,
  getMe,
  getAllCashiers,
  updateCashier,
} from '../controllers/authController';

const router = express.Router();

router.post('/login', login);
router.post('/register', register);
router.get('/me', protect, getMe);
router.get('/cashiers', protect, adminOnly, getAllCashiers);
router.put('/cashiers/:id', protect, adminOnly, updateCashier);

export default router;
