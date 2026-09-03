import { Request, Response } from 'express';
import SingleVisit from '../models/SingleVisit';
import Transaction from '../models/Transaction';
import { AuthCashier, canAccessShift, getShiftFilter } from '../middleware/auth';

// Helper to compute Cairo UTC start and end bounds
const getCairoDayBounds = (dateStr?: string) => {
  let targetCairo: Date;
  if (dateStr && dateStr !== 'today') {
    const [y, m, d] = dateStr.split('-').map(Number);
    targetCairo = new Date(y, m - 1, d, 0, 0, 0, 0);
  } else {
    const nowCairoStr = new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' });
    const nowCairo = new Date(nowCairoStr);
    targetCairo = new Date(nowCairo.getFullYear(), nowCairo.getMonth(), nowCairo.getDate(), 0, 0, 0, 0);
  }

  const dayEndCairo = new Date(targetCairo);
  dayEndCairo.setHours(23, 59, 59, 999);

  const toUtc = (d: Date) => {
    const temp = new Date(d.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
    return new Date(d.getTime() - (temp.getTime() - d.getTime()));
  };

  return {
    startUtc: toUtc(targetCairo),
    endUtc: toUtc(dayEndCairo),
  };
};

export const createSingleVisit = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const { name, phone, amount, paymentMethod, notes, visitDate } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'الاسم مطلوب ويجب أن يكون حرفين على الأقل' });
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ success: false, message: 'المبلغ يجب أن يكون رقماً أكبر من صفر' });
    }

    const cleanPhone = phone ? phone.trim() : '';
    if (cleanPhone !== '') {
      const phoneRegex = /^01[0125]\d{8}$/;
      if (!phoneRegex.test(cleanPhone)) {
        return res.status(400).json({ success: false, message: 'رقم الموبايل غير صحيح (يجب أن يكون 11 رقم يبدأ بـ 01)' });
      }
    }

    // Shift Isolation: Backend always sets shiftType from JWT
    let assignedShiftType: 'GIRLS' | 'BOYS' = 'BOYS';
    if (cashier.role === 'admin') {
      assignedShiftType = (req.body.shiftType === 'GIRLS' || req.body.shiftType === 'BOYS')
        ? req.body.shiftType
        : 'BOYS';
    } else if (cashier.shiftType) {
      assignedShiftType = cashier.shiftType;
    }

    // Support optional backdate for admin or BOYS cashier
    const visitedAt = ((cashier.role === 'admin' || cashier.shiftType === 'BOYS') && visitDate)
      ? new Date(`${visitDate}T12:00:00.000Z`)
      : new Date();

    const singleVisit = await SingleVisit.create({
      name: name.trim(),
      phone: cleanPhone,
      amount: numAmount,
      paymentMethod: paymentMethod || 'CASH',
      shiftType: assignedShiftType,
      createdBy: cashier.id,
      visitedAt,
      notes: notes ? notes.trim() : '',
    });

    // Create financial transaction
    const transaction = await Transaction.create({
      type: 'income',
      category: 'single_visit',
      amount: numAmount,
      date: visitedAt,
      singleVisitId: singleVisit._id,
      customerName: name.trim(),
      shiftType: assignedShiftType,
      paymentMethod: paymentMethod || 'CASH',
      description: `حصة فردية - ${name.trim()} (${assignedShiftType === 'GIRLS' ? 'شفت بنات' : 'شفت شباب'})`,
      createdBy: cashier.id,
      notes: notes ? notes.trim() : '',
    });

    singleVisit.transactionId = transaction._id as any;
    await singleVisit.save();

    const populated = await singleVisit.populate([
      { path: 'createdBy', select: 'name username role shiftType' },
    ]);

    return res.status(201).json({
      success: true,
      message: 'تم تسجيل الحصة الفردية بنجاح ✅',
      data: populated,
    });
  } catch (err: any) {
    console.error('Error creating single visit:', err);
    return res.status(500).json({ success: false, message: err.message || 'حدث خطأ أثناء تسجيل الحصة' });
  }
};

export const getSingleVisits = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const { date, search, shiftType, paymentMethod } = req.query;

    const query: any = {};

    // Shift Isolation
    if (cashier.role !== 'admin' && cashier.shiftType) {
      query.shiftType = cashier.shiftType;
    } else if (shiftType && (shiftType === 'GIRLS' || shiftType === 'BOYS')) {
      query.shiftType = shiftType;
    }

    if (paymentMethod) {
      query.paymentMethod = paymentMethod;
    }

    if (date) {
      const { startUtc, endUtc } = getCairoDayBounds(date as string);
      query.visitedAt = { $gte: startUtc, $lte: endUtc };
    }

    if (search && typeof search === 'string' && search.trim() !== '') {
      const s = search.trim();
      query.$or = [
        { name: { $regex: s, $options: 'i' } },
        { phone: { $regex: s, $options: 'i' } },
      ];
    }

    const visits = await SingleVisit.find(query)
      .populate('createdBy', 'name username role shiftType')
      .sort({ visitedAt: -1 });

    const totalAmount = visits.reduce((acc, v) => acc + (v.amount || 0), 0);

    return res.json({
      success: true,
      count: visits.length,
      totalAmount,
      data: visits,
    });
  } catch (err: any) {
    console.error('Error fetching single visits:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getSingleVisitById = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const visit = await SingleVisit.findById(req.params.id).populate('createdBy', 'name username');

    if (!visit) {
      return res.status(404).json({ success: false, message: 'سجل الزيارة غير موجود' });
    }

    if (!canAccessShift(cashier, visit.shiftType)) {
      return res.status(403).json({ success: false, message: 'ليس لديك صلاحية للوصول لبيانات هذا الشفت' });
    }

    return res.json({ success: true, data: visit });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteSingleVisit = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const visit = await SingleVisit.findById(req.params.id);

    if (!visit) {
      return res.status(404).json({ success: false, message: 'سجل الزيارة غير موجود' });
    }

    if (!canAccessShift(cashier, visit.shiftType)) {
      return res.status(403).json({ success: false, message: 'ليس لديك صلاحية لحذف بيانات هذا الشفت' });
    }

    // Cascade delete associated transaction
    if (visit.transactionId) {
      await Transaction.findByIdAndDelete(visit.transactionId);
    }
    await SingleVisit.findByIdAndDelete(visit._id);

    return res.json({ success: true, message: 'تم حذف سجل الحصة الفردية والمعاملة المالية بنجاح' });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getTodaySingleVisitsStats = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier: AuthCashier = (req as any).cashier;
    const { startUtc, endUtc } = getCairoDayBounds('today');

    const matchQuery: any = {
      visitedAt: { $gte: startUtc, $lte: endUtc },
    };

    if (cashier.role !== 'admin' && cashier.shiftType) {
      matchQuery.shiftType = cashier.shiftType;
    } else if (req.query.shiftType && (req.query.shiftType === 'GIRLS' || req.query.shiftType === 'BOYS')) {
      matchQuery.shiftType = req.query.shiftType;
    }

    const todayVisits = await SingleVisit.find(matchQuery);
    const count = todayVisits.length;
    const revenue = todayVisits.reduce((acc, v) => acc + (v.amount || 0), 0);

    return res.json({
      success: true,
      data: {
        todayCount: count,
        todayRevenue: revenue,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
