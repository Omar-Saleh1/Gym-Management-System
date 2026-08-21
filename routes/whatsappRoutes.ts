import express from 'express';
import { getQrPage, getStatus } from '../controllers/whatsappController';

const router = express.Router();

router.get('/status', getStatus);
router.get('/qr', getQrPage);

export default router;
