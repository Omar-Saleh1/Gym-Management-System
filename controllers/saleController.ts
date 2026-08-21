import { Request, Response } from 'express';
import Sale from '../models/Sale';
import Product from '../models/Product';

export const createSale = async (req: Request, res: Response): Promise<any> => {
  try {
    const { items, paymentMethod, memberId } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'لازم منتج واحد على الأقل' });
    }

    let total = 0;
    const saleItems = [];

    for (const item of items) {
      if (!item.productId || !item.quantity || item.quantity < 1) {
        return res.status(400).json({ message: 'بيانات المنتج غلط' });
      }

      const product = await Product.findById(item.productId);
      if (!product) {
        return res.status(404).json({ message: `منتج مش موجود: ${item.productId}` });
      }
      if (!product.active) {
        return res.status(400).json({ message: `المنتج ده مش متاح: ${product.name}` });
      }
      if (product.stock < item.quantity) {
        return res.status(400).json({
          message: `الكمية مش كفاية من: ${product.name} (متاح: ${product.stock})`,
        });
      }

      product.stock -= item.quantity;
      await product.save();

      saleItems.push({
        product: product._id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
      });
      total += product.price * item.quantity;
    }

    const sale = await Sale.create({
      items: saleItems,
      total,
      paymentMethod: paymentMethod || 'cash',
      member: memberId || undefined,
      cashier: (req as any).cashier.id,
    });

    const populated = await sale.populate([
      { path: 'cashier', select: 'name' },
      { path: 'member', select: 'name' },
    ]);

    res.status(201).json(populated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getSales = async (req: Request, res: Response): Promise<any> => {
  try {
    const { from, to } = req.query;
    const query: any = {};

    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from as string);
      if (to) {
        const toDate = new Date(to as string);
        toDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = toDate;
      }
    }

    const sales = await Sale.find(query)
      .populate('cashier', 'name')
      .populate('member', 'name')
      .sort({ createdAt: -1 });

    res.json(sales);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getSaleById = async (req: Request, res: Response): Promise<any> => {
  try {
    const sale = await Sale.findById(req.params.id)
      .populate('cashier', 'name')
      .populate('member', 'name')
      .populate('items.product', 'name barcode');

    if (!sale) return res.status(404).json({ message: 'عملية البيع مش موجودة' });
    res.json(sale);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
