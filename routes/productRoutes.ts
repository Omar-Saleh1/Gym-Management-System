import express from 'express';
import { protect } from '../middleware/auth';
import { upload } from '../middleware/upload';
import {
  getProducts,
  getProductById,
  getCategories,
  createProduct,
  updateProduct,
  deleteProduct,
} from '../controllers/productController';

const router = express.Router();
router.use(protect);

router.get('/',            getProducts);
router.get('/categories',  getCategories);
router.get('/:id',         getProductById);
router.post('/',           upload.single('image'), createProduct);
router.put('/:id',         upload.single('image'), updateProduct);
router.delete('/:id',      deleteProduct);

export default router;

