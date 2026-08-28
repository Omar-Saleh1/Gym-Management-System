import { Request, Response } from 'express';
import Transaction from '../models/Transaction';
import mongoose from 'mongoose';

// Cairo Date Helper to build UTC range bounds
const getCairoUtcRange = (range: string, from?: string, to?: string) => {
  const now = new Date();
  const cairoStr = now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' });
  const cairoDate = new Date(cairoStr);
  
  const startOfTodayCairo = new Date(cairoDate.getFullYear(), cairoDate.getMonth(), cairoDate.getDate());
  
  let startDateCairo = new Date(startOfTodayCairo);
  let endDateCairo = new Date(startOfTodayCairo);
  endDateCairo.setHours(23, 59, 59, 999);
  
  if (range === 'yesterday') {
    startDateCairo.setDate(startDateCairo.getDate() - 1);
    endDateCairo.setDate(endDateCairo.getDate() - 1);
  } else if (range === 'week') {
    startDateCairo.setDate(startDateCairo.getDate() - startDateCairo.getDay());
  } else if (range === 'month') {
    startDateCairo = new Date(startDateCairo.getFullYear(), startDateCairo.getMonth(), 1);
  } else if (range === 'custom') {
    if (from) {
      startDateCairo = new Date(from);
      startDateCairo.setHours(0, 0, 0, 0);
    }
    if (to) {
      endDateCairo = new Date(to);
      endDateCairo.setHours(23, 59, 59, 999);
    }
  }

  const getUtcDate = (localDate: Date) => {
    const localTime = localDate.getTime();
    const temp = new Date(localDate.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
    const diff = temp.getTime() - localDate.getTime();
    return new Date(localTime - diff);
  };
  
  return {
    start: getUtcDate(startDateCairo),
    end: getUtcDate(endDateCairo)
  };
};

export const getTransactions = async (req: Request, res: Response): Promise<any> => {
  try {
    const { type, category, dateRange, from, to, method, memberId, coachId } = req.query;
    const query: any = {};

    if (type) query.type = type;
    if (category) query.category = category;
    if (method) query.paymentMethod = method;
    if (memberId) query.memberId = memberId;
    if (coachId) query.coachId = coachId;

    if (dateRange || from || to) {
      const { start, end } = getCairoUtcRange(
        (dateRange as string) || 'custom',
        from as string,
        to as string
      );
      query.date = { $gte: start, $lte: end };
    }

    const transactions = await Transaction.find(query)
      .populate('memberId', 'name phone')
      .populate('coachId', 'name')
      .populate('createdBy', 'name')
      .sort({ date: -1 });

    res.status(200).json({ success: true, data: transactions });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getTransactionsDashboard = async (req: Request, res: Response): Promise<any> => {
  try {
    const { dateRange, from, to } = req.query;
    const range = (dateRange as string) || 'today';
    const { start, end } = getCairoUtcRange(range, from as string, to as string);

    // Cairo Current Month Start
    const now = new Date();
    const cairoStr = now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' });
    const cairoDate = new Date(cairoStr);
    const startOfCairoMonth = new Date(cairoDate.getFullYear(), cairoDate.getMonth(), 1);
    
    const getUtcDate = (localDate: Date) => {
      const localTime = localDate.getTime();
      const temp = new Date(localDate.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
      const diff = temp.getTime() - localDate.getTime();
      return new Date(localTime - diff);
    };
    
    const startMonthUtc = getUtcDate(startOfCairoMonth);

    // Queries
    const queryRange = { date: { $gte: start, $lte: end } };
    const queryMonth = { date: { $gte: startMonthUtc } };

    const aggregateTotal = async (matchQuery: any, type: 'income' | 'expense') => {
      const res = await Transaction.aggregate([
        { $match: { ...matchQuery, type } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]);
      return res.length > 0 ? res[0].total : 0;
    };

    const [
      rangeIncome,
      rangeExpense,
      monthIncome,
      monthExpense,
      recent
    ] = await Promise.all([
      aggregateTotal(queryRange, 'income'),
      aggregateTotal(queryRange, 'expense'),
      aggregateTotal(queryMonth, 'income'),
      aggregateTotal(queryMonth, 'expense'),
      Transaction.find({})
        .populate('memberId', 'name')
        .populate('coachId', 'name')
        .sort({ date: -1 })
        .limit(10)
    ]);

    res.status(200).json({
      success: true,
      data: {
        rangeStats: {
          income: rangeIncome,
          expense: rangeExpense,
          netProfit: rangeIncome - rangeExpense
        },
        monthStats: {
          income: monthIncome,
          expense: monthExpense,
          netProfit: monthIncome - monthExpense
        },
        recent
      }
    });

  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
