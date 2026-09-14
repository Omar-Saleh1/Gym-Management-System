import express from 'express';
import { getQrPage, getStatus, restartSession } from '../controllers/whatsappController';

const router = express.Router();

router.get('/status', getStatus);
router.get('/qr', getQrPage);
router.get('/restart', restartSession);

export default router;
