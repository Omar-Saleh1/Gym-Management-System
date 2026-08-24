import { Request, Response } from 'express';
import DietPlan from '../models/DietPlan';
import Member from '../models/Member';
import { sendNotification } from '../services/notification.service';

export const createDietPlan = async (req: Request, res: Response): Promise<any> => {
  try {
    const { memberId, planName, goal, calories, protein, carbs, fats, startDate, endDate, meals, notes } = req.body;

    if (!memberId || !planName) {
      return res.status(400).json({ success: false, message: 'Member and planName are required' });
    }

    const member = await Member.findById(memberId);
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    const dietPlan = await DietPlan.create({
      member: memberId,
      trainer: (req as any).cashier.id || (req as any).cashier._id,
      planName,
      goal,
      calories,
      protein,
      carbs,
      fats,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      meals: meals || [],
      notes,
    });

    await sendNotification({
      member: member as any,
      type: 'diet_plan',
      message: `تم إنشاء نظام غذائي جديد لك: ${planName} (${calories || '-'} سعرة حرارية)`,
    });

    res.status(201).json({ success: true, dietPlan });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getMemberDietPlans = async (req: Request, res: Response): Promise<any> => {
  try {
    const { memberId } = req.params;
    const plans = await DietPlan.find({ member: memberId })
      .populate('trainer', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: plans });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getDietPlan = async (req: Request, res: Response): Promise<any> => {
  try {
    const plan = await DietPlan.findById(req.params.id)
      .populate('member', 'name')
      .populate('trainer', 'name');

    if (!plan) return res.status(404).json({ success: false, message: 'Diet plan not found' });

    res.status(200).json({ success: true, data: plan });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateDietPlan = async (req: Request, res: Response): Promise<any> => {
  try {
    const plan = await DietPlan.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!plan) return res.status(404).json({ success: false, message: 'Diet plan not found' });

    res.status(200).json({ success: true, data: plan });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteDietPlan = async (req: Request, res: Response): Promise<any> => {
  try {
    const plan = await DietPlan.findByIdAndDelete(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Diet plan not found' });

    res.status(200).json({ success: true, message: 'Diet plan deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
