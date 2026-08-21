import express from 'express';
import { protect } from '../middleware/auth';
import { getLogs, getStats, triggerJobs } from '../controllers/notificationController';

const router = express.Router();
router.use(protect);

router.get('/',        getLogs);
router.get('/stats',   getStats);
router.post('/trigger', triggerJobs);   // manual trigger for testing

export default router;
