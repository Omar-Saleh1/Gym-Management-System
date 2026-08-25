import { Request, Response } from 'express';
import Subscription from '../models/Subscription';
import SubscriptionPlan from '../models/SubscriptionPlan';
import Member from '../models/Member';
import {
  notifyPaymentSuccess,
  notifySubscriptionFrozen,
  notifySubscriptionUnfrozen,
} from '../services/notification.service';

export const getPlans = async (req: Request, res: Response): Promise<any> => {
  try {
    const plans = await SubscriptionPlan.find({ active: true }).sort({ price: 1 });
    res.json(plans);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const createPlan = async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, durationInDays, price } = req.body;
    if (!name || !durationInDays || !price) {
      return res.status(400).json({ message: 'الاسم والمدة والسعر مطلوبين' });
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
    res.json({ message: 'تم إلغاء تفعيل الخطة' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getSubscriptions = async (req: Request, res: Response): Promise<any> => {
  try {
    const { expiringSoon } = req.query;
    let query: any = {};

    if (expiringSoon) {
      const soon = new Date();
      soon.setDate(soon.getDate() + 7);
      query = { status: 'active', endDate: { $lte: soon, $gte: new Date() } };
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

export const createSubscription = async (req: Request, res: Response): Promise<any> => {
  try {
    const { memberId, planId, paymentMethod } = req.body;

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

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.durationInDays);

    const subscription = await Subscription.create({
      member: memberId,
      plan: planId,
      startDate,
      endDate,
      pricePaid: plan.price,
      paymentMethod: paymentMethod || 'cash',
      createdBy: (req as any).cashier.id,
    });

    const populated = await subscription.populate([
      { path: 'member', select: 'name phone qrToken active' },
      { path: 'plan', select: 'name durationInDays price' },
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

export const cancelSubscription = async (req: Request, res: Response): Promise<any> => {
  try {
    const subscription = await Subscription.findByIdAndUpdate(
      req.params.id,
      { status: 'cancelled' },
      { new: true }
    );
    if (!subscription) return res.status(404).json({ message: 'الاشتراك مش موجود' });
    res.json({ message: 'تم إلغاء الاشتراك' });
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
