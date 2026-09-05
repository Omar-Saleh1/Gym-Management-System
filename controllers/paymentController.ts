import { Request, Response } from 'express';
import Payment from '../models/Payment';
import Subscription from '../models/Subscription';
import Member from '../models/Member';
import Expense from '../models/Expense';
import Transaction from '../models/Transaction';
import mongoose from 'mongoose';
import { getShiftFilter, canAccessShift, AuthCashier } from '../middleware/auth';
import { getBusinessDayBounds, getBusinessMonthBounds, getCairoNow } from '../utils/businessDay';

// ─── Create Payment ──────────────────────────────────────────────────────────
export const createPayment = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const { memberId, subscriptionId, amount, paymentMethod, paidAmount, notes } = req.body;

    if (!memberId || !amount || paidAmount === undefined) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    if (amount < 0 || paidAmount < 0) {
      return res.status(400).json({ success: false, message: 'Amount cannot be negative' });
    }
    if (paidAmount > amount) {
      return res.status(400).json({ success: false, message: 'Paid amount cannot exceed total amount' });
    }

    const member = await Member.findById(memberId);
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    // SHIFT CHECK — backend verifies member belongs to cashier's shift
    if (!canAccessShift(cashier, member.shiftType)) {
      return res.status(403).json({ success: false, message: 'هذا العضو لا ينتمي لشفتك' });
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

    if (paidAmount > 0) {
      await Transaction.create({
        type: 'income',
        category: subscriptionId ? 'subscription' : 'other',
        amount: paidAmount,
        date: new Date(),
        memberId,
        subscriptionId: subscriptionId || undefined,
        paymentId: payment._id,
        paymentMethod,
        createdBy: (req as any).cashier.id || (req as any).cashier._id,
        notes,
      });
    }

    res.status(201).json({ success: true, payment });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Pay Remaining Balance ──────────────────────────────────────────────────
export const payRemaining = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const { amountPaid, paymentMethod } = req.body;
    const { id } = req.params;

    if (!amountPaid || amountPaid <= 0) {
      return res.status(400).json({ success: false, message: 'مبلغ الدفع يجب أن يكون أكبر من الصفر' });
    }

    const payment = await Payment.findById(id).populate('member');
    if (!payment) {
      return res.status(404).json({ success: false, message: 'الدفعة غير موجودة' });
    }

    // IDOR check — verify the member of this payment is in the cashier's shift
    const member = await Member.findById(payment.member);
    if (member && !canAccessShift(cashier, member.shiftType)) {
      return res.status(403).json({ success: false, message: 'هذا العضو لا ينتمي لشفتك' });
    }

    if (amountPaid > payment.remainingAmount) {
      return res.status(400).json({ success: false, message: 'المبلغ المدفوع أكبر من المتبقي' });
    }

    payment.paidAmount += amountPaid;
    payment.remainingAmount -= payment.remainingAmount < amountPaid ? payment.remainingAmount : amountPaid;
    payment.status = payment.remainingAmount === 0 ? 'PAID' : 'PARTIAL';
    payment.paymentDate = new Date();
    if (paymentMethod) payment.paymentMethod = paymentMethod;
    await payment.save();

    await Transaction.create({
      type: 'income',
      category: payment.subscription ? 'subscription' : 'other',
      amount: amountPaid,
      date: new Date(),
      memberId: payment.member,
      subscriptionId: payment.subscription || undefined,
      paymentId: payment._id,
      paymentMethod: paymentMethod || payment.paymentMethod,
      createdBy: (req as any).cashier.id || (req as any).cashier._id,
      notes: 'سداد جزء متبقي من الدفعة',
    });

    res.status(200).json({ success: true, payment });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Revenue Dashboard — scoped by shift ─────────────────────────────────────
export const getRevenueDashboard = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const dayBounds = getBusinessDayBounds();
    const monthBounds = getBusinessMonthBounds();

    const cairoDate = getCairoNow();
    const startOfWeek = new Date(cairoDate);
    startOfWeek.setDate(cairoDate.getDate() - cairoDate.getDay());
    const weekBounds = getBusinessDayBounds(`${startOfWeek.getFullYear()}-${String(startOfWeek.getMonth() + 1).padStart(2, '0')}-${String(startOfWeek.getDate()).padStart(2, '0')}`);

    const startOfTodayUtc = dayBounds.startUtc;
    const startOfWeekUtc  = weekBounds.startUtc;
    const startOfMonthUtc = monthBounds.startUtc;

    // Shift filter for transactions (by createdBy cashier's shift, based on JWT)
    // We filter transactions by cashier's shiftType using member's shiftType via a lookup,
    // but for simplicity we use the createdBy field which refers to the cashier.
    // A cashier only creates transactions for their own shift (enforced by createPayment).
    // For aggregate view, we need to get IDs of cashiers in same shift.
    // Simpler approach: filter by member.shiftType via an aggregation $lookup or by pre-filtering memberIds.

    const memberShiftFilter = getShiftFilter(cashier); // { shiftType } or {}
    let memberIds: any[] = [];
    let hasMemberFilter = false;

    if (Object.keys(memberShiftFilter).length > 0) {
      hasMemberFilter = true;
      const shiftMembers = await Member.find({ ...memberShiftFilter, active: true }).select('_id');
      memberIds = shiftMembers.map(m => m._id);
    }

    const buildTxMatch = (dateFilter: any) => {
      const match: any = { ...dateFilter, type: 'income' };
      if (hasMemberFilter) {
        match.$or = [
          { memberId: { $in: memberIds } },
          { shiftType: cashier.shiftType },
        ];
      }
      return match;
    };

    const aggregateRevenue = async (matchQuery: any) => {
      const result = await Transaction.aggregate([
        { $match: matchQuery },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]);
      return result.length > 0 ? result[0].total : 0;
    };

    const todayRev  = await aggregateRevenue(buildTxMatch({ date: { $gte: startOfTodayUtc } }));
    const weekRev   = await aggregateRevenue(buildTxMatch({ date: { $gte: startOfWeekUtc } }));
    const monthRev  = await aggregateRevenue(buildTxMatch({ date: { $gte: startOfMonthUtc } }));
    const totalRev  = await aggregateRevenue(buildTxMatch({}));

    const paymentMemberFilter = hasMemberFilter ? { member: { $in: memberIds } } : {};

    const outstandingResult = await Payment.aggregate([
      { $match: { remainingAmount: { $gt: 0 }, ...paymentMemberFilter } },
      { $group: { _id: null, total: { $sum: '$remainingAmount' } } }
    ]);
    const outstanding = outstandingResult.length > 0 ? outstandingResult[0].total : 0;

    const pendingPayments = await Payment.countDocuments({ status: 'PENDING', ...paymentMemberFilter });
    const txCount = await Transaction.countDocuments({ type: 'income', ...(hasMemberFilter ? { memberId: { $in: memberIds } } : {}) });

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

// ─── Get Payments — scoped by shift ──────────────────────────────────────────
export const getPayments = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const { startDate, endDate, method, status, memberId } = req.query;
    const query: any = {};

    if (startDate || endDate) {
      query.paymentDate = {};
      if (startDate) query.paymentDate.$gte = new Date(startDate as string);
      if (endDate) query.paymentDate.$lte = new Date(endDate as string);
    }
    if (method) query.paymentMethod = method;
    if (status) query.status = status;
    if (memberId) {
      // IDOR: verify this member belongs to the cashier's shift
      const member = await Member.findById(memberId as string);
      if (member && !canAccessShift(cashier, member.shiftType)) {
        return res.status(403).json({ success: false, message: 'هذا العضو لا ينتمي لشفتك' });
      }
      query.member = memberId;
    } else {
      // No specific memberId — scope to shift
      const memberShiftFilter = getShiftFilter(cashier);
      if (Object.keys(memberShiftFilter).length > 0) {
        const shiftMembers = await Member.find({ ...memberShiftFilter }).select('_id');
        query.member = { $in: shiftMembers.map(m => m._id) };
      }
    }

    const payments = await Payment.find(query)
      .populate('member', 'name phone')
      .populate('createdBy', 'name')
      .sort({ paymentDate: -1 });

    res.status(200).json({ success: true, data: payments });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

