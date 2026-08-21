import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import Product from '../models/Product';
import { PRODUCT_CATEGORIES } from '../models/Product';

export const getProducts = async (req: Request, res: Response): Promise<any> => {
  try {
    const { search, category } = req.query;
    const query: any = { active: true };

    if (search) query.name = new RegExp(search as string, 'i');
    if (category && category !== 'الكل') query.category = category;

    const products = await Product.find(query).sort({ name: 1 });
    res.json(products);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getCategories = async (_req: Request, res: Response): Promise<any> => {
  res.json(PRODUCT_CATEGORIES);
};

export const getProductById = async (req: Request, res: Response): Promise<any> => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'المنتج مش موجود' });
    res.json(product);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const createProduct = async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, price } = req.body;
    if (!name || !price) {
      return res.status(400).json({ message: 'اسم المنتج والسعر مطلوبين' });
    }

    // If a file was uploaded, set the image path
    const image = (req as any).file
      ? `/uploads/products/${(req as any).file.filename}`
      : '';

    const product = await Product.create({ ...req.body, image });
    res.status(201).json(product);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const updateProduct = async (req: Request, res: Response): Promise<any> => {
  try {
    const updateData: any = { ...req.body };

    // If a new image file was uploaded
    if ((req as any).file) {
      // Delete old image if exists
      const existing = await Product.findById(req.params.id);
      if (existing?.image) {
        const oldPath = path.join(process.cwd(), existing.image);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      updateData.image = `/uploads/products/${(req as any).file.filename}`;
    }

    const product = await Product.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });
    if (!product) return res.status(404).json({ message: 'المنتج مش موجود' });
    res.json(product);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteProduct = async (req: Request, res: Response): Promise<any> => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { active: false },
      { new: true }
    );
    if (!product) return res.status(404).json({ message: 'المنتج مش موجود' });
    res.json({ message: 'تم حذف المنتج' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
