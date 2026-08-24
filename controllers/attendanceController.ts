import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Attendance from '../models/Attendance';
import Member from '../models/Member';
import Subscription from '../models/Subscription';
import { sendWhatsApp, templates } from '../services/whatsapp.service';

// ─── helper ───────────────────────────────────────────────────────────────────

const todayString = () => new Date().toISOString().split('T')[0]; // "2026-08-20"

// ─── QR Scan (smart: checkin → checkout toggle) ───────────────────────────────

export const scanQR = async (req: Request, res: Response): Promise<any> => {
  try {
    const qrToken = req.body.qrToken || req.body.code || req.body.qrCode;
    if (!qrToken) return res.status(400).json({ success: false, message: 'Missing QR token' });

    const token = qrToken.trim();

    // 1. Find member by qrToken field (secure – no MongoDB ID exposed)
    const member = await Member.findOne({ qrToken: token });
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }
    
    // Check if QR is active
    if (member.isQrActive === false) {
      return res.status(403).json({ success: false, message: 'QR Code is inactive' });
    }

    if (!member.active) {
      return res.status(403).json({ success: false, message: 'Member account is inactive' });
    }

    // Timezone suitable for Egypt
    const now = new Date();
    const cairoTimeStr = now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' });
    const cairoTime = new Date(cairoTimeStr);
    const today = cairoTime.getFullYear() + '-' + String(cairoTime.getMonth() + 1).padStart(2, '0') + '-' + String(cairoTime.getDate()).padStart(2, '0');

    // Check for frozen subscription
    const frozenSub = await Subscription.findOne({
      member: member._id,
      status: 'frozen',
    });
    if (frozenSub) {
      return res.status(422).json({
        success: false,
        message: 'Membership subscription is frozen',
      });
    }

    // Verify that membership exists and is active/not expired
    const activeSub = await Subscription.findOne({
      member: member._id,
      status: 'active',
      startDate: { $lte: now },
      endDate: { $gte: now },
    });

    if (!activeSub) {
      return res.status(422).json({
        success: false,
        message: 'Membership subscription has expired',
      });
    }

    // Check if checked in today
    const existing = await Attendance.findOne({
      member: member._id,
      date: today,
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Member already checked in today',
      });
    }

    // Record attendance
    const attendanceRecord = await Attendance.create({
      member:      member._id,
      checkInTime: now,
      date:        today,
      qrToken:     token,
      method:      'QR',
      status:      'CHECKED_IN',
    });

    // Send WhatsApp Notification (Non-blocking)
    if (member.phone) {
      const timeStr = cairoTime.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit', hour12: true });
      sendWhatsApp(member.phone, templates.checkInSuccess(member.name, timeStr)).catch(e => console.error('[WhatsApp] checkin notification error:', e));
    }

    return res.status(200).json({
      success: true,
      message: 'Check-in successful',
      member: {
        id: member._id,
        name: member.name
      },
      attendance: {
        checkIn: attendanceRecord.checkInTime,
        date: attendanceRecord.date
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
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
    const memberId = req.body.memberId || req.params.memberId;
    
    if (!memberId) {
      return res.status(400).json({ success: false, message: 'Missing memberId' });
    }

    const record = await Attendance.findOne({
      member: memberId,
      date:   today,
      status: { $in: ['open', 'CHECKED_IN'] }
    });

    if (!record) {
      return res.status(404).json({ success: false, message: 'No active check-in found' });
    }

    record.checkOutTime = new Date();
    record.status       = 'CHECKED_OUT';
    await record.save();

    res.status(200).json({
      success: true,
      message: 'Check-out successful',
      attendance: record
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
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

// ─── Get Today's Attendance ───────────────────────────────────────────────────
export const getTodayAttendance = async (req: Request, res: Response): Promise<any> => {
  try {
    const today = todayString();
    const records = await Attendance.find({ date: today })
      .populate('member', 'name phone qrToken')
      .sort({ checkInTime: -1 });
    res.status(200).json({ success: true, data: records });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Get Attendance Statistics ────────────────────────────────────────────────
export const getAttendanceStats = async (req: Request, res: Response): Promise<any> => {
  try {
    const today = todayString();
    
    // Cairo Date calculation for beginning of week/month
    const now = new Date();
    const cairoTimeStr = now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' });
    const cairoDate = new Date(cairoTimeStr);
    
    // Start of Month
    const startOfMonthDate = new Date(cairoDate.getFullYear(), cairoDate.getMonth(), 1);
    const startOfMonth = startOfMonthDate.getFullYear() + '-' + String(startOfMonthDate.getMonth() + 1).padStart(2, '0') + '-01';
    
    // Start of Week (assuming Sunday as start)
    const startOfWeekDate = new Date(cairoDate);
    startOfWeekDate.setDate(cairoDate.getDate() - cairoDate.getDay());
    const startOfWeek = startOfWeekDate.getFullYear() + '-' + String(startOfWeekDate.getMonth() + 1).padStart(2, '0') + '-' + String(startOfWeekDate.getDate()).padStart(2, '0');

    const todayCount = await Attendance.countDocuments({ date: today });
    const monthCount = await Attendance.countDocuments({ date: { $gte: startOfMonth } });
    const weekCount = await Attendance.countDocuments({ date: { $gte: startOfWeek } });
    
    // Average Daily (rough estimate based on days elapsed in month)
    const daysElapsed = cairoDate.getDate() || 1;
    const averageDaily = Math.round(monthCount / daysElapsed);

    res.status(200).json({
      success: true,
      stats: {
        today: todayCount,
        thisWeek: weekCount,
        thisMonth: monthCount,
        averageDaily,
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
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

