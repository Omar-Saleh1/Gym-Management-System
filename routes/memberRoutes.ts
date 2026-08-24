import express from 'express';
import { protect } from '../middleware/auth';
import {
  getMembers,
  getMemberById,
  createMember,
  updateMember,
  deleteMember,
  getPublicMemberByToken,
  getMemberQrCode,
  regenerateMemberQr,
  toggleMemberQr,
  getMemberProfile,
} from '../controllers/memberController';

const router = express.Router();

// Public routes (No authentication needed)
router.get('/public/qr/:token', getPublicMemberByToken);

// Protected routes
router.use(protect);

router.get('/', getMembers);
router.get('/:id', getMemberById);
router.post('/', createMember);
router.put('/:id', updateMember);
router.delete('/:id', deleteMember);

// QR Management Routes
router.get('/:id/qr', getMemberQrCode);
router.post('/:id/qr/regenerate', regenerateMemberQr);
router.patch('/:id/qr', toggleMemberQr);

// Profile (full data aggregation)
router.get('/:id/profile', getMemberProfile);

export default router;
