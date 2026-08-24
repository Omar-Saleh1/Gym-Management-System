import { Request, Response } from 'express';
import WorkoutPlan from '../models/WorkoutPlan';
import Member from '../models/Member';
import { sendNotification } from '../services/notification.service';

export const createWorkoutPlan = async (req: Request, res: Response): Promise<any> => {
  try {
    const { memberId, planName, goal, duration, startDate, endDate, days, notes } = req.body;
    
    if (!memberId || !planName || !days) {
      return res.status(400).json({ success: false, message: 'Member, planName, and days are required' });
    }

    const member = await Member.findById(memberId);
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    const workoutPlan = await WorkoutPlan.create({
      member: memberId,
      trainer: (req as any).cashier.id || (req as any).cashier._id,
      planName,
      goal,
      duration,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      days,
      notes,
    });

    await sendNotification({
      member: member as any,
      type: 'workout_plan',
      message: `تم إنشاء جدول تدريبي جديد لك: ${planName}`,
    });

    res.status(201).json({ success: true, workoutPlan });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getMemberWorkoutPlans = async (req: Request, res: Response): Promise<any> => {
  try {
    const { memberId } = req.params;
    const plans = await WorkoutPlan.find({ member: memberId })
      .populate('trainer', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: plans });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getWorkoutPlan = async (req: Request, res: Response): Promise<any> => {
  try {
    const plan = await WorkoutPlan.findById(req.params.id)
      .populate('member', 'name')
      .populate('trainer', 'name');
      
    if (!plan) return res.status(404).json({ success: false, message: 'Workout plan not found' });
    
    res.status(200).json({ success: true, data: plan });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateWorkoutPlan = async (req: Request, res: Response): Promise<any> => {
  try {
    const plan = await WorkoutPlan.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!plan) return res.status(404).json({ success: false, message: 'Workout plan not found' });
    
    res.status(200).json({ success: true, data: plan });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteWorkoutPlan = async (req: Request, res: Response): Promise<any> => {
  try {
    const plan = await WorkoutPlan.findByIdAndDelete(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: 'Workout plan not found' });
    
    res.status(200).json({ success: true, message: 'Workout plan deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const completeWorkoutPlan = async (req: Request, res: Response): Promise<any> => {
  try {
    const plan = await WorkoutPlan.findByIdAndUpdate(req.params.id, { status: 'COMPLETED' }, { new: true });
    if (!plan) return res.status(404).json({ success: false, message: 'Workout plan not found' });
    
    res.status(200).json({ success: true, data: plan });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
