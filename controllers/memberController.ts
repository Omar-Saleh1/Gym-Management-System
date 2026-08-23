import { Request, Response } from 'express';
import mongoose from 'mongoose';
import QRCode from 'qrcode';
import crypto from 'crypto';
import Member from '../models/Member';
import Subscription from '../models/Subscription';

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
    const { name, phone } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ message: 'الاسم والتليفون مطلوبين' });
    }
    const member = await Member.create(req.body);
    res.status(201).json(member);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const updateMember = async (req: Request, res: Response): Promise<any> => {
  try {
    const member = await Member.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
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
