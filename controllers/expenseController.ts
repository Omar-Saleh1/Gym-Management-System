import { Request, Response } from 'express';
import Expense from '../models/Expense';
import Payment from '../models/Payment';
import Transaction from '../models/Transaction';

export const createExpense = async (req: Request, res: Response): Promise<any> => {
  try {
    const { title, amount, category, date, notes } = req.body;

    if (!title || !amount) {
      return res.status(400).json({ success: false, message: 'Title and amount are required' });
    }

    if (amount < 0) {
      return res.status(400).json({ success: false, message: 'Amount cannot be negative' });
    }

    const expenseDate = date ? new Date(date) : new Date();

    const expense = await Expense.create({
      title,
      amount,
      category,
      date: expenseDate,
      notes,
      createdBy: (req as any).cashier.id || (req as any).cashier._id,
    });

    await Transaction.create({
      type: 'expense',
      category: category ? category.toLowerCase() : 'other',
      amount,
      date: expenseDate,
      notes,
      description: title,
      createdBy: (req as any).cashier.id || (req as any).cashier._id,
    });

    res.status(201).json({ success: true, expense });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getExpenses = async (req: Request, res: Response): Promise<any> => {
  try {
    const { startDate, endDate, category } = req.query;
    const query: any = {};

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate as string);
      if (endDate) query.date.$lte = new Date(endDate as string);
    }
    if (category) query.category = category;

    const expenses = await Expense.find(query)
      .populate('createdBy', 'name')
      .sort({ date: -1 });

    res.status(200).json({ success: true, data: expenses });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getFinancialSummary = async (req: Request, res: Response): Promise<any> => {
  try {
    const { startDate, endDate } = req.query;
    const query: any = {};

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
