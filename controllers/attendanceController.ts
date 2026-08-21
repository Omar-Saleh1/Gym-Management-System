import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Attendance from '../models/Attendance';
import Member from '../models/Member';
import Subscription from '../models/Subscription';

// ─── helper ───────────────────────────────────────────────────────────────────

const todayString = () => new Date().toISOString().split('T')[0]; // "2026-08-20"

// ─── QR Scan (smart: checkin → checkout toggle) ───────────────────────────────

export const scanQR = async (req: Request, res: Response): Promise<any> => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: 'مفيش كود متقروء' });

    const token = code.trim();

    // Find member by qrToken field (secure – no MongoDB ID exposed)
    let member = await Member.findOne({ qrToken: token });
    if (!member && mongoose.Types.ObjectId.isValid(token)) {
      member = await Member.findById(token);
    }
    
    if (!member) return res.status(404).json({ message: 'الكود ده مش مرتبط بأي عضو' });
    if (!member.active) return res.status(400).json({ message: 'العضو مش نشط' });

    // Check for frozen subscription
    const frozenSub = await Subscription.findOne({
      member: member._id,
      status: 'frozen',
    });
    if (frozenSub) {
      return res.status(403).json({
        message: `❌ اشتراك ${member.name} مجمد حالياً. يرجى إلغاء التجميد أولاً.`,
        member: member.name,
      });
    }

    // Check for an active subscription
    const activeSub = await Subscription.findOne({
      member: member._id,
      status: 'active',
      endDate: { $gte: new Date() },
    });

    if (!activeSub) {
      return res.status(403).json({
        message: `❌ اشتراك ${member.name} منتهي أو مش موجود. يحتاج تجديد.`,
        member: member.name,
        requiresRenewal: true,
      });
    }

    const today = todayString();

    // Toggle: if open session exists → checkout; else → checkin
    const openRecord = await Attendance.findOne({
      member: member._id,
      date:   today,
      status: 'open',
    });

    if (openRecord) {
      // Checkout
      openRecord.checkOutTime = new Date();
      openRecord.status       = 'completed';
      await openRecord.save();

      const duration = Math.round(
        (openRecord.checkOutTime.getTime() - openRecord.checkInTime.getTime()) / 1000 / 60
      );

      return res.json({
        action:          'checkout',
        member:          member.name,
        time:            openRecord.checkOutTime,
        durationMinutes: duration,
      });
    }

    // Checkin
    const record = await Attendance.create({
      member:      member._id,
      checkInTime: new Date(),
      date:        today,
      qrToken:     token,
      status:      'open',
    });

    return res.status(201).json({
      action: 'checkin',
      member: member.name,
      time:   record.checkInTime,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Manual check-in (by memberId, for reception use) ────────────────────────

export const checkIn = async (req: Request, res: Response): Promise<any> => {
  try {
    const { memberId } = req.body;
    if (!memberId) return res.status(400).json({ message: 'معرّف العضو مطلوب' });

    const member = await Member.findById(memberId);
    if (!member) return res.status(404).json({ message: 'العضو مش موجود' });

    const today = todayString();

    const existing = await Attendance.findOne({ member: memberId, date: today, status: 'open' });
    if (existing) {
      return res.status(400).json({ message: 'العضو داخل بالفعل، سجّل انصرافه الأول' });
    }

    const record = await Attendance.create({
      member:      memberId,
      checkInTime: new Date(),
      date:        today,
      status:      'open',
    });

    res.status(201).json(record);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Check-out ────────────────────────────────────────────────────────────────

export const checkOut = async (req: Request, res: Response): Promise<any> => {
  try {
    const today = todayString();

    const record = await Attendance.findOne({
      member: req.params.memberId,
      date:   today,
      status: 'open',
    });

    if (!record) {
      return res.status(404).json({ message: 'مفيش تسجيل دخول مفتوح للعضو ده' });
    }

    record.checkOutTime = new Date();
    record.status       = 'completed';
    await record.save();

    const duration = Math.round(
      (record.checkOutTime.getTime() - record.checkInTime.getTime()) / 1000 / 60
    );
    res.json({ ...record.toObject(), durationMinutes: duration });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Get attendance list ──────────────────────────────────────────────────────

export const getAttendance = async (req: Request, res: Response): Promise<any> => {
  try {
    const { date, memberId } = req.query;
    const query: any = {};

    if (date) {
      query.date = date as string; // use the indexed string field
    }

    if (memberId) query.member = memberId;

    const records = await Attendance.find(query)
      .populate('member', 'name phone qrToken')
      .sort({ checkInTime: -1 });

    const recordsWithStatus = await Promise.all(
      records.map(async (r: any) => {
        if (!r.member) return r;
        const sub = await Subscription.findOne({ member: r.member._id }).sort({ endDate: -1 });
        let membershipStatus = 'Expired';
        if (sub) {
          const now = new Date();
          if (sub.status === 'active' && sub.endDate >= now) {
            membershipStatus = 'Active';
          } else if (sub.status === 'frozen') {
            membershipStatus = 'Frozen';
          }
        }
        const recordObj = r.toObject();
        if (recordObj.member) {
          recordObj.member.membershipStatus = membershipStatus;
        }
        return recordObj;
      })
    );

    res.json(recordsWithStatus);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Get member attendance history ───────────────────────────────────────────

export const getMemberHistory = async (req: Request, res: Response): Promise<any> => {
  try {
    const { memberId } = req.params;
    const limit = Number(req.query.limit) || 30;

    const records = await Attendance.find({ member: memberId })
      .sort({ checkInTime: -1 })
      .limit(limit);

    res.json(records);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Check-In by QR Code (Specific API from prompt requirements) ───────────────────

export const checkInByQR = async (req: Request, res: Response): Promise<any> => {
  try {
    const { qrCode } = req.body;
    if (!qrCode) {
      return res.status(400).json({ success: false, message: 'رمز الـ QR مطلوب' });
    }

    const token = qrCode.trim();

    // 1. Find member by qrToken
    let member = await Member.findOne({ qrToken: token });
    if (!member && mongoose.Types.ObjectId.isValid(token)) {
      member = await Member.findById(token);
    }

    if (!member) {
      return res.status(404).json({ success: false, message: '❌ Invalid QR Code' });
    }
    if (!member.active) {
      return res.status(400).json({ success: false, message: '❌ Member is Inactive' });
    }

    // Check for frozen subscription
    const frozenSub = await Subscription.findOne({
      member: member._id,
      status: 'frozen',
    });
    if (frozenSub) {
      return res.status(400).json({
        success: false,
        message: `❌ Membership Frozen (${member.name})`,
      });
    }

    // 2 & 3. Verify that membership is active
    const activeSub = await Subscription.findOne({
      member: member._id,
      status: 'active',
      endDate: { $gte: new Date() },
    });

    if (!activeSub) {
      return res.status(400).json({
        success: false,
        message: '❌ Membership Expired',
        requiresRenewal: true,
      });
    }

    const today = todayString();

    // 4. Check if checked in today
    const existing = await Attendance.findOne({
      member: member._id,
      date:   today,
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: '⚠️ Already Checked In Today',
        member: member.name,
        checkInTime: existing.checkInTime,
      });
    }

    // 5. Create attendance record
    const record = await Attendance.create({
      member:      member._id,
      checkInTime: new Date(),
      date:        today,
      qrToken:     token,
      status:      'open',
    });

    // 6. Return name, check-in time, and success status
    return res.status(201).json({
      success: true,
      member: member.name,
      checkInTime: record.checkInTime,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

