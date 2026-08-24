import { Request, Response } from 'express';
import Payment from '../models/Payment';
import Subscription from '../models/Subscription';
import Member from '../models/Member';
import Expense from '../models/Expense';
import mongoose from 'mongoose';

// ─── Create Payment ──────────────────────────────────────────────────────────
export const createPayment = async (req: Request, res: Response): Promise<any> => {
  try {
    const { memberId, subscriptionId, amount, paymentMethod, paidAmount, notes } = req.body;
    
    if (!memberId || !amount || paidAmount === undefined) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    if (amount < 0 || paidAmount < 0) {
      return res.status(400).json({ success: false, message: 'Amount cannot be negative' });
    }

    const member = await Member.findById(memberId);
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    if (subscriptionId) {
      const sub = await Subscription.findById(subscriptionId);
      if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });
    }

    const remainingAmount = amount - paidAmount;
    let status = 'PAID';
    if (remainingAmount > 0 && paidAmount > 0) status = 'PARTIAL';
    else if (paidAmount === 0) status = 'PENDING';

    const payment = await Payment.create({
      member: memberId,
      subscription: subscriptionId,
      amount,
      paymentMethod,
      status,
      paidAmount,
      remainingAmount,
      notes,
      createdBy: (req as any).cashier.id || (req as any).cashier._id,
    });

    res.status(201).json({ success: true, payment });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Revenue Dashboard ────────────────────────────────────────────────────────
export const getRevenueDashboard = async (req: Request, res: Response): Promise<any> => {
  try {
    const now = new Date();
    const cairoTimeStr = now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' });
    const cairoDate = new Date(cairoTimeStr);

    const startOfToday = new Date(cairoDate.getFullYear(), cairoDate.getMonth(), cairoDate.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
    const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);

    const aggregateRevenue = async (matchQuery: any) => {
      const result = await Payment.aggregate([
        { $match: matchQuery },
        { $group: { _id: null, total: { $sum: '$paidAmount' } } }
      ]);
      return result.length > 0 ? result[0].total : 0;
    };

    const todayRev = await aggregateRevenue({ paymentDate: { $gte: startOfToday } });
    const weekRev = await aggregateRevenue({ paymentDate: { $gte: startOfWeek } });
    const monthRev = await aggregateRevenue({ paymentDate: { $gte: startOfMonth } });
    const totalRev = await aggregateRevenue({});
    
    const outstandingResult = await Payment.aggregate([
      { $match: { remainingAmount: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$remainingAmount' } } }
    ]);
    const outstanding = outstandingResult.length > 0 ? outstandingResult[0].total : 0;

    const pendingPayments = await Payment.countDocuments({ status: 'PENDING' });
    const txCount = await Payment.countDocuments({});

    res.status(200).json({
      success: true,
      data: {
        todayRevenue: todayRev,
        thisWeekRevenue: weekRev,
        thisMonthRevenue: monthRev,
        totalRevenue: totalRev,
        outstandingAmount: outstanding,
        pendingPayments,
        transactionsCount: txCount,
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Get Payment Reports ──────────────────────────────────────────────────────
export const getPayments = async (req: Request, res: Response): Promise<any> => {
  try {
    const { startDate, endDate, method, status, memberId } = req.query;
    const query: any = {};

    if (startDate || endDate) {
      query.paymentDate = {};
      if (startDate) query.paymentDate.$gte = new Date(startDate as string);
      if (endDate) query.paymentDate.$lte = new Date(endDate as string);
    }
    if (method) query.paymentMethod = method;
    if (status) query.status = status;
    if (memberId) query.member = memberId;

    const payments = await Payment.find(query)
      .populate('member', 'name phone')
      .populate('createdBy', 'name')
      .sort({ paymentDate: -1 });

    res.status(200).json({ success: true, data: payments });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
