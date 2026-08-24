import express from 'express';
import { protect } from '../middleware/auth';
import {
  createDietPlan,
  getMemberDietPlans,
  getDietPlan,
  updateDietPlan,
  deleteDietPlan,
} from '../controllers/dietController';

const router = express.Router();
router.use(protect);

router.post('/',                    createDietPlan);
router.get('/member/:memberId',     getMemberDietPlans);
router.get('/:id',                  getDietPlan);
router.put('/:id',                  updateDietPlan);
router.delete('/:id',               deleteDietPlan);

export default router;
