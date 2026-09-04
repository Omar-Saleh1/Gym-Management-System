import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Attendance from '../models/Attendance';
import Member from '../models/Member';
import Subscription from '../models/Subscription';
import { sendWhatsApp, templates } from '../services/whatsapp.service';
import { getShiftFilter, canAccessShift, AuthCashier } from '../middleware/auth';

const todayString = () => new Date().toISOString().split('T')[0];


// ─── QR Scan (smart: checkin → checkout toggle) ───────────────────────────────

export const scanQR = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const qrToken = req.body.qrToken || req.body.code || req.body.qrCode;
    if (!qrToken) return res.status(400).json({ success: false, message: 'رمز الـ QR مطلوب' });

    const token = String(qrToken).trim();

    // 1. Find member by qrToken field or fallback to ObjectId
    let member = await Member.findOne({ qrToken: token });
    if (!member && mongoose.Types.ObjectId.isValid(token)) {
      member = await Member.findById(token);
    }

    if (!member) {
      return res.status(404).json({ success: false, message: 'العضو غير موجود' });
    }

    // SHIFT CHECK — core security: cashier cannot scan members from other shift
    if (!canAccessShift(cashier, member.shiftType)) {
      return res.status(403).json({ success: false, message: 'هذا العضو لا ينتمي لشفتك' });
    }

    // Check if Member is active
    if (!member.active) {
      return res.status(403).json({ success: false, message: 'حساب العضو غير نشط' });
    }

    // Check if QR is active
    if (member.isQrActive === false) {
      return res.status(403).json({ success: false, message: 'كود الـ QR معطل لهذا العضو' });
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
        message: 'الاشتراك مجمد حالياً.',
      });
    }

    // Verify active subscription (independent of any workout/diet plans)
    const activeSub = await Subscription.findOne({
      member: member._id,
      status: 'active',
      endDate: { $gte: now },
    }).sort({ endDate: -1 });

    if (!activeSub) {
      // Mark any outdated active subs as expired
      await Subscription.updateMany(
        { member: member._id, status: 'active', endDate: { $lt: now } },
        { status: 'expired' }
      );
      return res.status(422).json({
        success: false,
        message: 'الاشتراك منتهي، يرجى تجديد الاشتراك.',
      });
    }

    // Session-based: check remaining sessions BEFORE recording attendance
    if (activeSub.subscriptionType === 'sessions' && activeSub.sessionsLimit > 0) {
      if (activeSub.sessionsUsed >= activeSub.sessionsLimit) {
        // Exhausted — mark expired
        activeSub.status = 'expired';
        await activeSub.save();
        return res.status(422).json({
          success: false,
          message: `انتهت حصصك (${activeSub.sessionsLimit}/${activeSub.sessionsLimit})، يرجى تجديد الاشتراك.`,
        });
      }
    }

    // Check if checked in today
    const existing = await Attendance.findOne({
      member: member._id,
      date: today,
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'تم تسجيل حضور هذا العضو بالفعل اليوم',
      });
    }

    // Record attendance — denormalize shiftType for fast queries
    const attendanceRecord = await Attendance.create({
      member:      member._id,
      checkInTime: now,
      date:        today,
      qrToken:     token,
      method:      'QR',
      status:      'CHECKED_IN',
      shiftType:   member.shiftType,
    });

    // Session-based: increment sessionsUsed after successful check-in
    let sessionInfo: { sessionsUsed?: number; sessionsLimit?: number } = {};
    if (activeSub.subscriptionType === 'sessions' && activeSub.sessionsLimit > 0) {
      activeSub.sessionsUsed = (activeSub.sessionsUsed || 0) + 1;
      // If this was the last session, expire automatically
      if (activeSub.sessionsUsed >= activeSub.sessionsLimit) {
        activeSub.status = 'expired';
      }
      await activeSub.save();
      sessionInfo = { sessionsUsed: activeSub.sessionsUsed, sessionsLimit: activeSub.sessionsLimit };
    }

    // Send WhatsApp Notification (Non-blocking)
    if (member.phone) {
      const timeStr = cairoTime.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit', hour12: true });
      sendWhatsApp(member.phone, templates.checkInSuccess(member.name, timeStr)).catch(e => console.error('[WhatsApp] checkin notification error:', e));
    }

    return res.status(200).json({
      success: true,
      message: 'تم تسجيل الحضور بنجاح',
      member: { id: member._id, name: member.name },
      attendance: { checkIn: attendanceRecord.checkInTime, date: attendanceRecord.date },
      ...(sessionInfo.sessionsLimit ? { sessionInfo } : {}),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};



// ─── Manual check-in (by memberId, for reception use) ────────────────────────

export const checkIn = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const { memberId } = req.body;
    if (!memberId) return res.status(400).json({ message: 'معرّف العضو مطلوب' });

    const member = await Member.findById(memberId);
    if (!member) return res.status(404).json({ message: 'العضو مش موجود' });

    if (!member.active) {
      return res.status(403).json({ message: 'حساب العضو غير نشط' });
    }

    // SHIFT CHECK
    if (!canAccessShift(cashier, member.shiftType)) {
      return res.status(403).json({ message: 'This member does not belong to your shift' });
    }

    // Check frozen subscription
    const frozenSub = await Subscription.findOne({ member: member._id, status: 'frozen' });
    if (frozenSub) {
      return res.status(422).json({ message: 'الاشتراك مجمد حالياً.' });
    }

    // Check active subscription
    const now = new Date();
    const activeSub = await Subscription.findOne({
      member: member._id,
      status: 'active',
      endDate: { $gte: now },
    }).sort({ endDate: -1 });

    if (!activeSub) {
      return res.status(422).json({ message: 'الاشتراك منتهي، يرجى تجديد الاشتراك.', requiresRenewal: true });
    }

    // Check session limits
    if (activeSub.subscriptionType === 'sessions' && activeSub.sessionsLimit > 0) {
      if (activeSub.sessionsUsed >= activeSub.sessionsLimit) {
        activeSub.status = 'expired';
        await activeSub.save();
        return res.status(422).json({
          message: `انتهت حصصك (${activeSub.sessionsLimit}/${activeSub.sessionsLimit})، يرجى تجديد الاشتراك.`,
          requiresRenewal: true,
        });
      }
    }

    const cairoTimeStr = now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' });
    const cairoTime = new Date(cairoTimeStr);
    const today = cairoTime.getFullYear() + '-' + String(cairoTime.getMonth() + 1).padStart(2, '0') + '-' + String(cairoTime.getDate()).padStart(2, '0');

    const existing = await Attendance.findOne({ member: memberId, date: today });
    if (existing) {
      return res.status(400).json({ message: '⚠️ هذا العضو مسجّل حضور بالفعل اليوم! لا يمكن تسجيل الحضور أكثر من مرة في اليوم الواحد.' });
    }

    const record = await Attendance.create({
      member:      memberId,
      checkInTime: now,
      date:        today,
      method:      'MANUAL',
      status:      'open',
      shiftType:   member.shiftType,
    });

    // Increment sessionsUsed if session-based
    let sessionInfo: { sessionsUsed?: number; sessionsLimit?: number } = {};
    if (activeSub.subscriptionType === 'sessions' && activeSub.sessionsLimit > 0) {
      activeSub.sessionsUsed = (activeSub.sessionsUsed || 0) + 1;
      if (activeSub.sessionsUsed >= activeSub.sessionsLimit) {
        activeSub.status = 'expired';
      }
      await activeSub.save();
      sessionInfo = { sessionsUsed: activeSub.sessionsUsed, sessionsLimit: activeSub.sessionsLimit };
    }

    // Send WhatsApp notification if available
    if (member.phone) {
      const timeStr = cairoTime.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit', hour12: true });
      sendWhatsApp(member.phone, templates.checkInSuccess(member.name, timeStr)).catch(e => console.error('[WhatsApp] checkin notification error:', e));
    }

    res.status(201).json({
      ...record.toObject(),
      ...(sessionInfo.sessionsLimit ? { sessionInfo } : {}),
    });
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
    const cashier: AuthCashier = (req as any).cashier;
    const { date, memberId } = req.query;
    const query: any = {};

    if (date) {
      query.date = date as string;
    }
    if (memberId) query.member = memberId;

    // Shift filter — cashier sees only their shift's attendance
    const shiftFilter = getShiftFilter(cashier);
    Object.assign(query, shiftFilter);

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
    const cashier: AuthCashier = (req as any).cashier;
    const today = todayString();
    const shiftFilter = getShiftFilter(cashier);
    const records = await Attendance.find({ date: today, ...shiftFilter })
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
    const cashier: AuthCashier = (req as any).cashier;
    const today = todayString();
    const shiftFilter = getShiftFilter(cashier);

    const now = new Date();
    const cairoTimeStr = now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' });
    const cairoDate = new Date(cairoTimeStr);

    const startOfMonthDate = new Date(cairoDate.getFullYear(), cairoDate.getMonth(), 1);
    const startOfMonth = startOfMonthDate.getFullYear() + '-' + String(startOfMonthDate.getMonth() + 1).padStart(2, '0') + '-01';

    const startOfWeekDate = new Date(cairoDate);
    startOfWeekDate.setDate(cairoDate.getDate() - cairoDate.getDay());
    const startOfWeek = startOfWeekDate.getFullYear() + '-' + String(startOfWeekDate.getMonth() + 1).padStart(2, '0') + '-' + String(startOfWeekDate.getDate()).padStart(2, '0');

    const todayCount = await Attendance.countDocuments({ date: today, ...shiftFilter });
    const monthCount = await Attendance.countDocuments({ date: { $gte: startOfMonth }, ...shiftFilter });
    const weekCount  = await Attendance.countDocuments({ date: { $gte: startOfWeek }, ...shiftFilter });

    const daysElapsed = cairoDate.getDate() || 1;
    const averageDaily = Math.round(monthCount / daysElapsed);

    res.status(200).json({
      success: true,
      stats: { today: todayCount, thisWeek: weekCount, thisMonth: monthCount, averageDaily }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const checkInByQR = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const qrCode = req.body.qrCode || req.body.qrToken || req.body.code;
    if (!qrCode) {
      return res.status(400).json({ success: false, message: 'رمز الـ QR مطلوب' });
    }

    const token = String(qrCode).trim();

    let member = await Member.findOne({ qrToken: token });
    if (!member && mongoose.Types.ObjectId.isValid(token)) {
      member = await Member.findById(token);
    }

    if (!member) {
      return res.status(404).json({ success: false, message: 'العضو غير موجود' });
    }
    if (!member.active) {
      return res.status(403).json({ success: false, message: 'حساب العضو غير نشط' });
    }
    if (member.isQrActive === false) {
      return res.status(403).json({ success: false, message: 'كود الـ QR معطل لهذا العضو' });
    }

    // SHIFT CHECK
    if (!canAccessShift(cashier, member.shiftType)) {
      return res.status(403).json({ success: false, message: 'هذا العضو لا ينتمي لشفتك' });
    }

    const frozenSub = await Subscription.findOne({ member: member._id, status: 'frozen' });
    if (frozenSub) {
      return res.status(422).json({ success: false, message: 'الاشتراك مجمد حالياً.' });
    }

    const now = new Date();
    const activeSub = await Subscription.findOne({
      member: member._id, status: 'active', endDate: { $gte: now },
    }).sort({ endDate: -1 });

    if (!activeSub) {
      return res.status(422).json({ success: false, message: 'الاشتراك منتهي، يرجى تجديد الاشتراك.', requiresRenewal: true });
    }

    if (activeSub.subscriptionType === 'sessions' && activeSub.sessionsLimit > 0) {
      if (activeSub.sessionsUsed >= activeSub.sessionsLimit) {
        activeSub.status = 'expired';
        await activeSub.save();
        return res.status(422).json({
          success: false,
          message: `انتهت حصصك (${activeSub.sessionsLimit}/${activeSub.sessionsLimit})، يرجى تجديد الاشتراك.`,
          requiresRenewal: true
        });
      }
    }

    const cairoTimeStr = now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' });
    const cairoTime = new Date(cairoTimeStr);
    const today = cairoTime.getFullYear() + '-' + String(cairoTime.getMonth() + 1).padStart(2, '0') + '-' + String(cairoTime.getDate()).padStart(2, '0');

    const existing = await Attendance.findOne({ member: member._id, date: today });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'تم تسجيل حضور هذا العضو بالفعل اليوم',
        member: member.name,
        checkInTime: existing.checkInTime,
      });
    }

    const record = await Attendance.create({
      member:      member._id,
      checkInTime: now,
      date:        today,
      qrToken:     token,
      method:      'QR',
      status:      'CHECKED_IN',
      shiftType:   member.shiftType,
    });

    if (activeSub.subscriptionType === 'sessions' && activeSub.sessionsLimit > 0) {
      activeSub.sessionsUsed = (activeSub.sessionsUsed || 0) + 1;
      if (activeSub.sessionsUsed >= activeSub.sessionsLimit) {
        activeSub.status = 'expired';
      }
      await activeSub.save();
    }

    if (member.phone) {
      const timeStr = cairoTime.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit', hour12: true });
      sendWhatsApp(member.phone, templates.checkInSuccess(member.name, timeStr)).catch(e => console.error('[WhatsApp] checkin notification error:', e));
    }

    return res.status(201).json({ success: true, message: 'تم تسجيل الحضور بنجاح', member: member.name, checkInTime: record.checkInTime });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Delete Attendance Record ───────────────────────────────────────────────────
export const deleteAttendance = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const { id } = req.params;

    const record = await Attendance.findById(id).populate('member');
    if (!record) {
      return res.status(404).json({ success: false, message: 'سجل الحضور غير موجود' });
    }

    const member = record.member as any;
    if (member && member.shiftType && !canAccessShift(cashier, member.shiftType)) {
      return res.status(403).json({ success: false, message: 'هذا السجل لا ينتمي لشفتك' });
    }

    // If session-based subscription, restore 1 session
    if (member) {
      const sub = await Subscription.findOne({ member: member._id, subscriptionType: 'sessions' }).sort({ endDate: -1 });
      if (sub && sub.sessionsUsed > 0) {
        sub.sessionsUsed = Math.max(0, sub.sessionsUsed - 1);
        if (sub.status === 'expired' && sub.sessionsUsed < sub.sessionsLimit) {
          sub.status = 'active';
        }
        await sub.save();
      }
    }

    await Attendance.findByIdAndDelete(id);

    return res.status(200).json({ success: true, message: 'تم حذف سجل الحضور بنجاح' });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

