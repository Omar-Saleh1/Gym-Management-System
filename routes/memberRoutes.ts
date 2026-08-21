import express from 'express';
import { protect } from '../middleware/auth';
import {
  getMembers,
  getMemberById,
  createMember,
  updateMember,
  deleteMember,
  getPublicMemberByToken,
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

export default router;
