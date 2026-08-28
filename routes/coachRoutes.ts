import express from 'express';
import { protect, adminOnly } from '../middleware/auth';
import {
  getCoaches,
  createCoach,
  updateCoach,
  deleteCoach,
  getSalaries,
  paySalary
} from '../controllers/coachController';

const router = express.Router();

router.use(protect);

router.get('/', getCoaches);
router.post('/', adminOnly, createCoach);
router.put('/:id', adminOnly, updateCoach);
router.delete('/:id', adminOnly, deleteCoach);

router.get('/salaries', adminOnly, getSalaries);
router.post('/salaries', adminOnly, paySalary);

export default router;
