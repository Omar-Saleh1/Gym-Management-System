import { Request, Response } from 'express';
import Sale from '../models/Sale';
import Product from '../models/Product';
import Transaction from '../models/Transaction';
import { AuthCashier, canAccessShift } from '../middleware/auth';
import { getBusinessDayBounds } from '../utils/businessDay';

export const createSale = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const { items, paymentMethod, memberId, notes, shiftType } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'لازم منتج واحد على الأقل' });
    }

    let assignedShiftType: 'GIRLS' | 'BOYS' = 'BOYS';
    if (cashier.role === 'admin') {
      assignedShiftType = (shiftType === 'GIRLS' || shiftType === 'BOYS') ? shiftType : 'BOYS';
    } else if (cashier.shiftType) {
      assignedShiftType = cashier.shiftType;
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
      notes: notes || '',
      member: memberId || undefined,
      cashier: cashier.id,
      shiftType: assignedShiftType,
    });

    // Create corresponding financial transaction
    const itemSummary = saleItems.map(i => `${i.name} (×${i.quantity})`).join('، ');
    const pMethod = (paymentMethod && paymentMethod.toLowerCase() === 'card') ? 'CARD' : 'CASH';

    const transaction = await Transaction.create({
      type: 'income',
      category: 'store',
      amount: total,
      date: sale.createdAt || new Date(),
      saleId: sale._id,
      shiftType: assignedShiftType,
      paymentMethod: pMethod,
      description: `مبيعات متجر: ${itemSummary}`,
      notes: notes || '',
      createdBy: cashier.id,
    });

    sale.transactionId = transaction._id as any;
    await sale.save();

    const populated = await sale.populate([
      { path: 'cashier', select: 'name username role shiftType' },
      { path: 'member', select: 'name phone' },
      { path: 'items.product', select: 'name category price' }
    ]);

    res.status(201).json(populated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getSales = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const { from, to, date, cashierId, shiftType } = req.query;
    const query: any = {};

    if (cashier.role !== 'admin' && cashier.shiftType) {
      query.shiftType = cashier.shiftType;
    } else if (shiftType && (shiftType === 'GIRLS' || shiftType === 'BOYS')) {
      query.shiftType = shiftType;
    }

    if (cashierId) query.cashier = cashierId;

    if (date) {
      const { startUtc, endUtc } = getBusinessDayBounds(date as string);
      query.createdAt = { $gte: startUtc, $lte: endUtc };
    } else if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from as string);
      if (to) {
        const toDate = new Date(to as string);
        toDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = toDate;
      }
    }

    const sales = await Sale.find(query)
      .populate('cashier', 'name username role shiftType')
      .populate('member', 'name phone')
      .populate('items.product', 'name category price')
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
      .populate('items.product', 'name category price barcode');

    if (!sale) return res.status(404).json({ message: 'عملية البيع مش موجودة' });
    res.json(sale);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteSale = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const sale = await Sale.findById(req.params.id);

    if (!sale) {
      return res.status(404).json({ success: false, message: 'عملية البيع غير موجودة' });
    }

    if (sale.shiftType && !canAccessShift(cashier, sale.shiftType)) {
      return res.status(403).json({ success: false, message: 'ليس لديك صلاحية لحذف مبيعات هذا الشفت' });
    }

    // 1. Restore product stock quantities
    if (sale.items && sale.items.length > 0) {
      for (const item of sale.items) {
        if (item.product) {
          await Product.findByIdAndUpdate(item.product, {
            $inc: { stock: item.quantity }
          });
        }
      }
    }

    // 2. Delete linked Transaction
    if (sale.transactionId) {
      await Transaction.findByIdAndDelete(sale.transactionId);
    }
    await Transaction.deleteMany({ saleId: sale._id });

    // 3. Delete the Sale document
    await Sale.findByIdAndDelete(sale._id);

    return res.json({
      success: true,
      message: 'تم حذف عملية البيع بنجاح واسترجاع الكميات إلى المخزون وخصم المبلغ من الإيراد ✅'
    });
  } catch (err: any) {
    console.error('Error deleting sale:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
