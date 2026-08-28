import { Request, Response } from 'express';
import Coach from '../models/Coach';
import CoachSalary from '../models/CoachSalary';
import Transaction from '../models/Transaction';

// ─── Coaches CRUD ─────────────────────────────────────────────────────────────
export const getCoaches = async (req: Request, res: Response): Promise<any> => {
  try {
    const coaches = await Coach.find({ active: true }).sort({ name: 1 });
    res.status(200).json({ success: true, data: coaches });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createCoach = async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, salary } = req.body;
    if (!name || salary === undefined) {
      return res.status(400).json({ success: false, message: 'الاسم والراتب مطلوبين' });
    }

    if (salary < 0) {
      return res.status(400).json({ success: false, message: 'الراتب لا يمكن أن يكون سالباً' });
    }

    const coach = await Coach.create({ name, salary });
    res.status(201).json({ success: true, data: coach });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateCoach = async (req: Request, res: Response): Promise<any> => {
  try {
    const coach = await Coach.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!coach) return res.status(404).json({ success: false, message: 'الكابتن غير موجود' });
    res.status(200).json({ success: true, data: coach });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteCoach = async (req: Request, res: Response): Promise<any> => {
  try {
    const coach = await Coach.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
    if (!coach) return res.status(404).json({ success: false, message: 'الكابتن غير موجود' });
    res.status(200).json({ success: true, message: 'تم إيقاف تفعيل الكابتن بنجاح' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Coach Salaries API ──────────────────────────────────────────────────────
export const getSalaries = async (req: Request, res: Response): Promise<any> => {
  try {
    const { month, coachId } = req.query;
    const query: any = {};
    if (month) query.month = month;
    if (coachId) query.coach = coachId;

    const salaries = await CoachSalary.find(query)
      .populate('coach', 'name salary')
      .populate('createdBy', 'name')
      .sort({ month: -1 });

    res.status(200).json({ success: true, data: salaries });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const paySalary = async (req: Request, res: Response): Promise<any> => {
  try {
    const { coachId, month, salaryAmount, paidAmount, paymentMethod, notes } = req.body;

    if (!coachId || !month || salaryAmount === undefined || paidAmount === undefined) {
      return res.status(400).json({ success: false, message: 'برجاء تعبئة الحقول المطلوبة' });
    }

    if (salaryAmount < 0 || paidAmount < 0) {
      return res.status(400).json({ success: false, message: 'المبالغ المالية لا يمكن أن تكون سالبة' });
    }

    if (paidAmount > salaryAmount) {
      return res.status(400).json({ success: false, message: 'المبلغ المدفوع لا يمكن أن يكون أكبر من الراتب الكلي' });
    }

    const coach = await Coach.findById(coachId);
    if (!coach) return res.status(404).json({ success: false, message: 'الكابتن غير موجود' });

    // Find or create monthly salary record
    let salaryRecord = await CoachSalary.findOne({ coach: coachId, month });

    if (salaryRecord) {
      // If updating an existing record, we pay an additional amount
      const newPaid = salaryRecord.paidAmount + paidAmount;
      if (newPaid > salaryRecord.salaryAmount) {
        return res.status(400).json({ success: false, message: 'المبلغ الإجمالي المدفوع يتجاوز الراتب المستحق' });
      }
      salaryRecord.paidAmount = newPaid;
      salaryRecord.remainingAmount = salaryRecord.salaryAmount - newPaid;
      salaryRecord.status = salaryRecord.remainingAmount === 0 ? 'PAID' : 'PARTIAL';
      salaryRecord.paymentDate = new Date();
      if (paymentMethod) salaryRecord.paymentMethod = paymentMethod;
      if (notes) salaryRecord.notes = notes;
      await salaryRecord.save();
    } else {
      const remainingAmount = salaryAmount - paidAmount;
      const status = remainingAmount === 0 ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'UNPAID';

      salaryRecord = await CoachSalary.create({
        coach: coachId,
        month,
        salaryAmount,
        paidAmount,
        remainingAmount,
        status,
        paymentMethod,
        paymentDate: paidAmount > 0 ? new Date() : undefined,
        notes,
        createdBy: (req as any).cashier.id || (req as any).cashier._id,
      });
    }

    // Log the expense transaction (only if paidAmount > 0)
    if (paidAmount > 0) {
      await Transaction.create({
        type: 'expense',
        category: 'coach_salary',
        amount: paidAmount,
        date: new Date(),
        coachId,
        coachSalaryId: salaryRecord._id,
        paymentMethod: paymentMethod || 'CASH',
        description: `صرف راتب الكابتن: ${coach.name} لشهر ${month}`,
        notes,
        createdBy: (req as any).cashier.id || (req as any).cashier._id,
      });
    }

    res.status(200).json({ success: true, data: salaryRecord });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
