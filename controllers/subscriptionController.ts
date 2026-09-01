import { Request, Response } from 'express';
import Subscription from '../models/Subscription';
import SubscriptionPlan from '../models/SubscriptionPlan';
import Member from '../models/Member';
import Payment from '../models/Payment';
import Transaction from '../models/Transaction';
import {
  notifyPaymentSuccess,
  notifySubscriptionFrozen,
  notifySubscriptionUnfrozen,
} from '../services/notification.service';

export const getPlans = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    let query: any = { active: true };

    const activeShift = cashier?.role === 'admin'
      ? (req.query.shiftType as string) || null
      : (cashier?.shiftType || null);

    if (activeShift && (activeShift === 'GIRLS' || activeShift === 'BOYS')) {
      query.shiftType = { $in: [activeShift, 'BOTH'] };
    }

    const plans = await SubscriptionPlan.find(query).sort({ price: 1 });
    res.json(plans);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const createPlan = async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, durationInDays, price } = req.body;
    if (!name || (!durationInDays && req.body.subscriptionType !== 'sessions') || !price) {
      return res.status(400).json({ message: 'الاسم والسعر مطلوبين' });
    }
    const plan = await SubscriptionPlan.create(req.body);
    res.status(201).json(plan);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const updatePlan = async (req: Request, res: Response): Promise<any> => {
  try {
    const plan = await SubscriptionPlan.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!plan) return res.status(404).json({ message: 'الخطة مش موجودة' });
    res.json(plan);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const deletePlan = async (req: Request, res: Response): Promise<any> => {
  try {
    const plan = await SubscriptionPlan.findByIdAndUpdate(
      req.params.id,
      { active: false },
      { new: true }
    );
    if (!plan) return res.status(404).json({ message: 'الخطة مش موجودة' });
    res.json({ message: 'تم حذف الخطة بنجاح' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

import { getShiftFilter, canAccessShift, AuthCashier } from '../middleware/auth';

export const getSubscriptions = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const { expiringSoon } = req.query;

    // Get member IDs scoped to this cashier's shift
    const memberShiftFilter = getShiftFilter(cashier);
    let memberIds: any[] | null = null;
    if (Object.keys(memberShiftFilter).length > 0) {
      const shiftMembers = await Member.find({ ...memberShiftFilter }).select('_id');
      memberIds = shiftMembers.map(m => m._id);
    }

    let query: any = memberIds ? { member: { $in: memberIds } } : {};

    if (expiringSoon) {
      const soon = new Date();
      soon.setDate(soon.getDate() + 7);
      query = { ...query, status: 'active', endDate: { $lte: soon, $gte: new Date() } };
    }

    const subscriptions = await Subscription.find(query)
      .populate('member', 'name phone')
      .populate('plan', 'name durationInDays price')
      .sort({ endDate: 1 });

    res.json(subscriptions);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getExpiringSoon = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const { days = '7' } = req.query;

    const daysNum = Number(days);
    if (isNaN(daysNum) || !Number.isInteger(daysNum) || daysNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'عدد الأيام يجب أن يكون رقماً صحيحاً أكبر من الصفر / Days must be a positive integer'
      });
    }

    const now = new Date();
    const soon = new Date();
    soon.setDate(soon.getDate() + daysNum);

    // Scope to shift
    const memberShiftFilter = getShiftFilter(cashier);
    let memberFilter: any = {};
    if (Object.keys(memberShiftFilter).length > 0) {
      const shiftMembers = await Member.find({ ...memberShiftFilter }).select('_id');
      memberFilter = { member: { $in: shiftMembers.map(m => m._id) } };
    }

    const subscriptions = await Subscription.find({
      status: 'active',
      endDate: { $gte: now, $lte: soon },
      ...memberFilter,
    })
    .populate('member', 'name phone email')
    .populate('plan', 'name durationInDays price')
    .sort({ endDate: 1 });

    res.json({ success: true, count: subscriptions.length, data: subscriptions });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createSubscription = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const { memberId, planId, paymentMethod, pricePaid: customPricePaid, paidAmount: customPaidAmount } = req.body;

    if (!memberId || !planId) {
      return res.status(400).json({ message: 'معرّف العضو والخطة مطلوبين' });
    }

    const [member, plan] = await Promise.all([
      Member.findById(memberId),
      SubscriptionPlan.findById(planId),
    ]);

    if (!member) return res.status(404).json({ message: 'العضو مش موجود' });
    if (!plan) return res.status(404).json({ message: 'الخطة مش موجودة' });
    if (!plan.active) return res.status(400).json({ message: 'الخطة دي مش متاحة حالياً' });

    // SHIFT CHECK — cashier can only subscribe members of their shift
    if (!canAccessShift(cashier, member.shiftType)) {
      return res.status(403).json({ message: 'هذا العضو لا ينتمي لشفتك' });
    }

    const totalAmount = customPricePaid !== undefined ? Number(customPricePaid) : plan.price;
    const paidAmount = customPaidAmount !== undefined ? Number(customPaidAmount) : plan.price;

    if (totalAmount < 0 || paidAmount < 0) {
      return res.status(400).json({ message: 'المبالغ المالية لا يمكن أن تكون سالبة' });
    }

    if (paidAmount > totalAmount) {
      return res.status(400).json({ message: 'المبلغ المدفوع لا يمكن أن يكون أكبر من المبلغ المطلوب' });
    }

    const startDate = new Date();
    const endDate = new Date();

    // Session-based: give 30-day window regardless; expiry is controlled by sessionsUsed >= sessionsLimit
    // Days-based: use plan.durationInDays
    const isSessions = plan.subscriptionType === 'sessions';
    endDate.setDate(endDate.getDate() + (isSessions ? 30 : plan.durationInDays));

    const subscription = await Subscription.create({
      member: memberId,
      plan: planId,
      startDate,
      endDate,
      pricePaid: totalAmount,
      paymentMethod: paymentMethod || 'CASH',
      createdBy: (req as any).cashier.id || (req as any).cashier._id,
      notes: req.body.notes || '',
      subscriptionType: plan.subscriptionType || 'days',
      sessionsLimit: isSessions ? (plan.sessionsLimit || 0) : 0,
      sessionsUsed: 0,
    });

    // Reactivate Member QR automatically
    member.active = true;
    member.isQrActive = true;
    await member.save();

    const remainingAmount = totalAmount - paidAmount;
    let paymentStatus = 'PAID';
    if (remainingAmount > 0 && paidAmount > 0) paymentStatus = 'PARTIAL';
    else if (paidAmount === 0) paymentStatus = 'PENDING';

    const payment = await Payment.create({
      member: memberId,
      subscription: subscription._id,
      amount: totalAmount,
      paidAmount,
      remainingAmount,
      paymentMethod: paymentMethod || 'CASH',
      status: paymentStatus,
      createdBy: (req as any).cashier.id || (req as any).cashier._id,
      notes: req.body.notes || '',
    });

    if (paidAmount > 0) {
      await Transaction.create({
        type: 'income',
        category: 'subscription',
        amount: paidAmount,
        date: new Date(),
        memberId,
        subscriptionId: subscription._id,
        paymentId: payment._id,
        paymentMethod: paymentMethod || 'CASH',
        createdBy: (req as any).cashier.id || (req as any).cashier._id,
        notes: req.body.notes || '',
      });
    }

    const populated = await subscription.populate([
      { path: 'member', select: 'name phone qrToken active' },
      { path: 'plan', select: 'name durationInDays price subscriptionType sessionsLimit' },
    ]);

    // Skip notification for Day Pass (1 day duration)
    if (plan.durationInDays !== 1) {
      // Check if member has previous subscriptions
      const previousSubsCount = await Subscription.countDocuments({ 
        member: memberId, 
        _id: { $ne: subscription._id } 
      });
      const isRenewal = previousSubsCount > 0;

      // Send WhatsApp notification with QR link
      notifyPaymentSuccess(
        populated.member as any, 
        populated as any, 
        (populated.plan as any).name,
        isRenewal
      ).catch((err) => {
        console.error('Failed to send WhatsApp notification:', err);
      });
    }

    res.status(201).json(populated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};


export const updateSubscription = async (req: Request, res: Response): Promise<any> => {
  try {
    const subscription = await Subscription.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    })
      .populate('member', 'name phone')
      .populate('plan', 'name durationInDays price');

    if (!subscription) return res.status(404).json({ message: 'الاشتراك مش موجود' });
    res.json(subscription);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteSubscription = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const sub = await Subscription.findById(req.params.id).populate('member');
    if (!sub) return res.status(404).json({ message: 'الاشتراك مش موجود' });

    const member = sub.member as any;
    if (member && member.shiftType && !canAccessShift(cashier, member.shiftType)) {
      return res.status(403).json({ message: 'هذا الاشتراك لا ينتمي لشفتك' });
    }

    await Subscription.findByIdAndDelete(req.params.id);
    res.json({ message: 'تم حذف الاشتراك بنجاح' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const freezeSubscription = async (req: Request, res: Response): Promise<any> => {
  try {
    const sub = await Subscription.findById(req.params.id).populate<{ member: any }>('member');
    if (!sub) return res.status(404).json({ message: 'الاشتراك مش موجود' });
    if (sub.status !== 'active') {
      return res.status(400).json({ message: 'يمكن فقط تجميد الاشتراكات النشطة' });
    }

    const freezeStart = new Date();
    const freezeEnd = new Date();
    freezeEnd.setDate(freezeEnd.getDate() + 7); // Exactly 1 week freeze limit

    sub.status = 'frozen';
    sub.freezeStartDate = freezeStart;
    sub.freezeEndDate = freezeEnd;
    await sub.save();

    if (sub.member && sub.member.active) {
      notifySubscriptionFrozen(sub.member, sub as any).catch(err => {
        console.error('Failed to send WhatsApp notification on freeze:', err);
      });
    }

    res.json({ message: 'تم تجميد الاشتراك بنجاح لمدة أسبوع ❄️', subscription: sub });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const unfreezeSubscription = async (req: Request, res: Response): Promise<any> => {
  try {
    const sub = await Subscription.findById(req.params.id).populate<{ member: any }>('member');
    if (!sub) return res.status(404).json({ message: 'الاشتراك مش موجود' });
    if (sub.status !== 'frozen') {
      return res.status(400).json({ message: 'الاشتراك ليس في حالة تجميد' });
    }

    // Calculate actual frozen duration in days (minimum 1 day)
    const today = new Date();
    const start = sub.freezeStartDate ? new Date(sub.freezeStartDate) : new Date();
    const diffTime = Math.abs(today.getTime() - start.getTime());
    const frozenDays = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)));

    // Shift subscription end date by the actual frozen duration
    const newEnd = new Date(sub.endDate);
    newEnd.setDate(newEnd.getDate() + frozenDays);

    sub.endDate = newEnd;
    sub.status = 'active';
    sub.freezeStartDate = undefined;
    sub.freezeEndDate = undefined;
    await sub.save();

    if (sub.member && sub.member.active) {
      notifySubscriptionUnfrozen(sub.member, sub as any).catch(err => {
        console.error('Failed to send WhatsApp notification on unfreeze:', err);
      });
    }

    res.json({ message: 'تم إلغاء التجميد وتنشيط الاشتراك بنجاح 🔥', subscription: sub });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
