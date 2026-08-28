import { Request, Response } from 'express';
import mongoose from 'mongoose';
import QRCode from 'qrcode';
import crypto from 'crypto';
import Member from '../models/Member';
import Subscription from '../models/Subscription';
import Attendance from '../models/Attendance';
import Payment from '../models/Payment';
import WorkoutPlan from '../models/WorkoutPlan';
import DietPlan from '../models/DietPlan';

export const getMembers = async (req: Request, res: Response): Promise<any> => {
  try {
    const { search } = req.query;
    const baseQuery = { active: true };
    const query = search
      ? { 
          ...baseQuery,
          $or: [{ name: new RegExp(search as string, 'i') }, { phone: new RegExp(search as string, 'i') }] 
        }
      : baseQuery;
    const members = await Member.find(query).sort({ createdAt: -1 });
    res.json(members);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getMemberById = async (req: Request, res: Response): Promise<any> => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'العضو مش موجود' });

    const subscriptions = await Subscription.find({ member: member._id })
      .populate('plan', 'name durationInDays price')
      .sort({ createdAt: -1 });

    res.json({ member, subscriptions });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const createMember = async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, phone, email } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ message: 'الاسم والتليفون مطلوبين' });
    }

    // Name validation
    if (name.trim().length < 3) {
      return res.status(400).json({ message: 'الاسم يجب أن يكون مكون من 3 حروف على الأقل' });
    }

    // Phone validation
    const phoneRegex = /^01[0125]\d{8}$/;
    if (!phoneRegex.test(phone.trim())) {
      return res.status(400).json({ message: 'رقم الموبايل غير صحيح. يجب أن يكون رقم مصري مكون من 11 رقم يبدأ بـ 01' });
    }

    // Duplicate phone check
    const existingPhone = await Member.findOne({ phone: phone.trim(), active: true });
    if (existingPhone) {
      return res.status(400).json({ message: 'رقم الموبايل مسجل بالفعل لعضو آخر' });
    }

    // Email validation
    if (email && email.trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ message: 'البريد الإلكتروني غير صحيح' });
      }
    }

    const member = await Member.create({
      ...req.body,
      name: name.trim(),
      phone: phone.trim(),
      email: email ? email.trim() : undefined
    });
    res.status(201).json(member);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const updateMember = async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, phone, email } = req.body;

    if (name && name.trim().length < 3) {
      return res.status(400).json({ message: 'الاسم يجب أن يكون مكون من 3 حروف على الأقل' });
    }

    if (phone) {
      const phoneRegex = /^01[0125]\d{8}$/;
      if (!phoneRegex.test(phone.trim())) {
        return res.status(400).json({ message: 'رقم الموبايل غير صحيح. يجب أن يكون رقم مصري مكون من 11 رقم يبدأ بـ 01' });
      }

      const existingPhone = await Member.findOne({ 
        phone: phone.trim(), 
        active: true, 
        _id: { $ne: req.params.id } 
      });
      if (existingPhone) {
        return res.status(400).json({ message: 'رقم الموبايل مسجل بالفعل لعضو آخر' });
      }
    }

    if (email && email.trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({ message: 'البريد الإلكتروني غير صحيح' });
      }
    }

    const member = await Member.findByIdAndUpdate(
      req.params.id, 
      {
        ...req.body,
        name: name ? name.trim() : undefined,
        phone: phone ? phone.trim() : undefined,
        email: email ? email.trim() : undefined
      }, 
      {
        new: true,
        runValidators: true,
      }
    );
    if (!member) return res.status(404).json({ message: 'العضو مش موجود' });
    res.json(member);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteMember = async (req: Request, res: Response): Promise<any> => {
  try {
    const member = await Member.findByIdAndUpdate(
      req.params.id,
      { active: false },
      { new: true }
    );
    if (!member) return res.status(404).json({ message: 'العضو مش موجود' });
    res.json({ message: 'تم تعطيل العضو بنجاح' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getPublicMemberByToken = async (req: Request, res: Response): Promise<any> => {
  try {
    const { token } = req.params;
    let member: any = await Member.findOne({ qrToken: token, active: true }).select('name qrToken');
    if (!member && mongoose.Types.ObjectId.isValid(token as string)) {
      member = await Member.findById(token as string).select('name qrToken');
    }
    
    if (!member) {
      return res.status(404).json({ message: 'العضو غير موجود أو غير نشط' });
    }

    // Find latest subscription to determine status and expiry
    const lastSub = await Subscription.findOne({ member: member._id })
      .sort({ endDate: -1 });

    let membershipStatus = 'Expired';
    let endDate = null;

    if (lastSub) {
      endDate = lastSub.endDate;
      const now = new Date();
      if (lastSub.status === 'active' && lastSub.endDate >= now) {
        membershipStatus = 'Active';
      } else if (lastSub.status === 'frozen') {
        membershipStatus = 'Frozen';
      }
    }

    res.json({
      name: member.name,
      qrToken: member.qrToken,
      membershipStatus,
      endDate,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getMemberQrCode = async (req: Request, res: Response): Promise<any> => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'العضو غير موجود' });

    if (!member.isQrActive) {
      return res.status(400).json({ message: 'الـ QR الخاص بهذا العضو معطل' });
    }

    const qrDataUrl = await QRCode.toDataURL(member.qrToken);
    res.json({ success: true, qrCode: qrDataUrl });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const regenerateMemberQr = async (req: Request, res: Response): Promise<any> => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'العضو غير موجود' });

    member.qrToken = crypto.randomBytes(24).toString('hex');
    await member.save();

    const qrDataUrl = await QRCode.toDataURL(member.qrToken);
    res.json({ success: true, message: 'تم إعادة إنشاء الـ QR بنجاح', qrCode: qrDataUrl });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const toggleMemberQr = async (req: Request, res: Response): Promise<any> => {
  try {
    const { isQrActive } = req.body;
    if (typeof isQrActive !== 'boolean') {
      return res.status(400).json({ message: 'يجب تحديد حالة الـ QR (مفعل/معطل)' });
    }

    const member = await Member.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'العضو غير موجود' });

    member.isQrActive = isQrActive;
    await member.save();

    res.json({ success: true, message: isQrActive ? 'تم تفعيل الـ QR' : 'تم تعطيل الـ QR' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── GET /api/members/:id/profile ────────────────────────────────────────────
export const getMemberProfile = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;

    const member = await Member.findById(id).select('-__v');
    if (!member) return res.status(404).json({ success: false, message: 'Member not found' });

    // Find latest subscription (regardless of status)
    const subscription = await Subscription.findOne({ member: id })
      .populate('plan', 'name price')
      .sort({ endDate: -1 });

    const subscriptionPayment = subscription ? await Payment.findOne({ subscription: subscription._id }) : null;

    // Attendance this month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const attendanceCount = await Attendance.countDocuments({
      member: id,
      date: { $gte: startOfMonth },
    });

    // Last 10 attendances
    const recentAttendance = await Attendance.find({ member: id })
      .sort({ checkInTime: -1 })
      .limit(10);

    // Payment summary
    const payments = await Payment.find({ member: id }).sort({ paymentDate: -1 });
    const totalPaid = payments.reduce((s, p) => s + p.paidAmount, 0);
    const totalRemaining = payments.reduce((s, p) => s + p.remainingAmount, 0);

    // Active workout plan
    const workoutPlan = await WorkoutPlan.findOne({ member: id, status: 'ACTIVE' })
      .populate('trainer', 'name')
      .sort({ createdAt: -1 });

    // Active diet plan
    const dietPlan = await DietPlan.findOne({ member: id, status: 'ACTIVE' })
      .populate('trainer', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      member,
      subscription,
      subscriptionPayment,
      attendance: {
        thisMonth: attendanceCount,
        recent: recentAttendance,
      },
      payments: {
        totalPaid,
        totalRemaining,
        history: payments,
      },
      workoutPlan,
      dietPlan,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
