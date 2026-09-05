import { Request, Response } from 'express';
import Expense from '../models/Expense';
import Transaction from '../models/Transaction';
import { getShiftFilter, canAccessShift, AuthCashier } from '../middleware/auth';
import { getBusinessDayBounds } from '../utils/businessDay';

export const createExpense = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier = (req as any).cashier as AuthCashier;
    const { title, amount, category, date, notes, paymentMethod, shiftType } = req.body;

    if (!title || !amount) {
      return res.status(400).json({ success: false, message: 'اسم المصروف والمبلغ مطلوبان' });
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ success: false, message: 'المبلغ يجب أن يكون رقماً موجباً' });
    }

    const expenseDate = date ? new Date(date) : new Date();
    const effectiveShift = cashier?.shiftType || (shiftType === 'GIRLS' || shiftType === 'BOYS' ? shiftType : undefined);
    const effectivePaymentMethod = paymentMethod && ['CASH', 'CARD', 'BANK_TRANSFER', 'ONLINE', 'OTHER'].includes(paymentMethod.toUpperCase())
      ? paymentMethod.toUpperCase()
      : 'CASH';

    const normalizedCategory = category ? category.toString().trim() : 'OTHER';

    // 1. Create Transaction (financial record for daily & monthly reports)
    const transaction = await Transaction.create({
      type: 'expense',
      category: normalizedCategory.toLowerCase(),
      amount: numAmount,
      date: expenseDate,
      notes,
      description: title,
      paymentMethod: effectivePaymentMethod,
      shiftType: effectiveShift,
      createdBy: cashier.id || (cashier as any)._id,
    });

    // 2. Create Expense document linked to Transaction
    const expense = await Expense.create({
      title,
      amount: numAmount,
      category: normalizedCategory.toUpperCase(),
      paymentMethod: effectivePaymentMethod,
      shiftType: effectiveShift,
      transactionId: transaction._id,
      date: expenseDate,
      notes,
      createdBy: cashier.id || (cashier as any)._id,
    });

    res.status(201).json({ success: true, message: 'تم تسجيل المصروف بنجاح', data: expense });
  } catch (err: any) {
    console.error('createExpense error:', err);
    res.status(500).json({ success: false, message: err.message || 'حدث خطأ أثناء تسجيل المصروف' });
  }
};

export const getExpenses = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier = (req as any).cashier as AuthCashier;
    const { startDate, endDate, date, category, shiftType } = req.query;

    const query: any = {};

    // Shift isolation
    if (cashier.role !== 'admin' && cashier.shiftType) {
      Object.assign(query, getShiftFilter(cashier));
    } else if (shiftType && (shiftType === 'GIRLS' || shiftType === 'BOYS')) {
      query.shiftType = shiftType;
    }

    // Date filtering (supports business day bounds if specific single date passed)
    if (date && typeof date === 'string') {
      const bounds = getBusinessDayBounds(date);
      query.date = { $gte: bounds.startUtc, $lte: bounds.endUtc };
    } else if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate as string);
      if (endDate) query.date.$lte = new Date(endDate as string);
    }

    if (category) {
      query.category = { $regex: new RegExp(`^${category}$`, 'i') };
    }

    const expenses = await Expense.find(query)
      .populate('createdBy', 'name username shiftType')
      .sort({ date: -1 });

    res.status(200).json({ success: true, data: expenses });
  } catch (err: any) {
    console.error('getExpenses error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteExpense = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier = (req as any).cashier as AuthCashier;
    const { id } = req.params;

    const expense = await Expense.findById(id);
    if (!expense) {
      return res.status(404).json({ success: false, message: 'المصروف غير موجود' });
    }

    if (!canAccessShift(cashier, expense.shiftType as string)) {
      return res.status(403).json({ success: false, message: 'غير مصرح لك بحذف هذا المصروف' });
    }

    // Delete linked Transaction if exists
    if (expense.transactionId) {
      await Transaction.findByIdAndDelete(expense.transactionId);
    } else {
      // Fallback matching
      await Transaction.deleteOne({
        type: 'expense',
        amount: expense.amount,
        description: expense.title,
        createdBy: expense.createdBy
      });
    }

    await Expense.findByIdAndDelete(id);

    res.status(200).json({ success: true, message: 'تم حذف المصروف وخصمه من الحسابات بنجاح' });
  } catch (err: any) {
    console.error('deleteExpense error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getFinancialSummary = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier = (req as any).cashier as AuthCashier;
    const { startDate, endDate, shiftType } = req.query;
    const query: any = {};

    if (cashier.role !== 'admin' && cashier.shiftType) {
      Object.assign(query, getShiftFilter(cashier));
    } else if (shiftType && (shiftType === 'GIRLS' || shiftType === 'BOYS')) {
      query.shiftType = shiftType;
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate as string);
      if (endDate) query.date.$lte = new Date(endDate as string);
    }

    const revenueResult = await Transaction.aggregate([
      { $match: { ...query, type: 'income' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

    const expenseResult = await Transaction.aggregate([
      { $match: { ...query, type: 'expense' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalExpenses = expenseResult.length > 0 ? expenseResult[0].total : 0;

    const netProfit = totalRevenue - totalExpenses;

    res.status(200).json({
      success: true,
      data: {
        totalRevenue,
        totalExpenses,
        netProfit,
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
