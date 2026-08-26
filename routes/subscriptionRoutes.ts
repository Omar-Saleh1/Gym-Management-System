import express from 'express';
import { protect } from '../middleware/auth';
import {
  getPlans,
  createPlan,
  updatePlan,
  deletePlan,
  getSubscriptions,
  createSubscription,
  updateSubscription,
  cancelSubscription,
  freezeSubscription,
  unfreezeSubscription,
  getExpiringSoon,
} from '../controllers/subscriptionController';

const router = express.Router();
router.use(protect);

router.get('/plans', getPlans);
router.post('/plans', createPlan);
router.put('/plans/:id', updatePlan);
router.delete('/plans/:id', deletePlan);

router.get('/expiring-soon', getExpiringSoon);
router.get('/', getSubscriptions);
router.post('/', createSubscription);
router.put('/:id', updateSubscription);
router.delete('/:id', cancelSubscription);
router.post('/:id/freeze', freezeSubscription);
router.post('/:id/unfreeze', unfreezeSubscription);

export default router;
