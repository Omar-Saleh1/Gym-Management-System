import express from 'express';
import { protect } from '../middleware/auth';
import { createSale, getSales, getSaleById } from '../controllers/saleController';

const router = express.Router();
router.use(protect);

router.get('/', getSales);
router.get('/:id', getSaleById);
router.post('/', createSale);

export default router;
