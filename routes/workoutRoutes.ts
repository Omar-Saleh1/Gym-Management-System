import express from 'express';
import { protect } from '../middleware/auth';
import {
  createWorkoutPlan,
  getMemberWorkoutPlans,
  getWorkoutPlan,
  updateWorkoutPlan,
  deleteWorkoutPlan,
  completeWorkoutPlan,
} from '../controllers/workoutController';

const router = express.Router();
router.use(protect);

router.post('/',                          createWorkoutPlan);
router.get('/member/:memberId',           getMemberWorkoutPlans);
router.get('/:id',                        getWorkoutPlan);
router.put('/:id',                        updateWorkoutPlan);
router.delete('/:id',                     deleteWorkoutPlan);
router.post('/:id/complete',              completeWorkoutPlan);

export default router;
