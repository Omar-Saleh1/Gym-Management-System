import express from 'express';
import { protect } from '../middleware/auth';
import {
  createSingleVisit,
  getSingleVisits,
  getSingleVisitById,
  deleteSingleVisit,
  getTodaySingleVisitsStats,
} from '../controllers/singleVisitController';

const router = express.Router();
router.use(protect);

router.post('/', createSingleVisit);
router.get('/', getSingleVisits);
router.get('/stats/today', getTodaySingleVisitsStats);
router.get('/:id', getSingleVisitById);
router.delete('/:id', deleteSingleVisit);

export default router;
