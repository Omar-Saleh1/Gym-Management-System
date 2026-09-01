import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Cashier from '../models/Cashier';

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_key_in_production';

const generateToken = (cashier: any) =>
  jwt.sign(
    {
      id: cashier._id,
      username: cashier.username,
      role: cashier.role,
      name: cashier.name,
      shiftType: cashier.shiftType || null, // null = admin/trainer (no shift restriction)
    },
    JWT_SECRET,
    { expiresIn: '12h' }
  );

export const login = async (req: Request, res: Response): Promise<any> => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'اليوزرنيم والباسورد مطلوبين' });
    }

    const cleanUsername = username.trim();
    const cashier = await Cashier.findOne({
      username: new RegExp('^' + cleanUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')
    });
    if (!cashier || !cashier.active) {
      return res.status(401).json({ message: 'يوزر أو باسورد غلط' });
    }

    const match = await bcrypt.compare(password, cashier.password!);
    if (!match) {
      return res.status(401).json({ message: 'يوزر أو باسورد غلط' });
    }

    res.json({
      token: generateToken(cashier),
      cashier: {
        id: cashier._id,
        name: cashier.name,
        username: cashier.username,
        role: cashier.role,
        shiftType: cashier.shiftType || null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const register = async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, username, password, role, shiftType } = req.body;

    if (!name || !username || !password) {
      return res.status(400).json({ message: 'الاسم واليوزرنيم والباسورد مطلوبين' });
    }

    const existing = await Cashier.findOne({ username: username.trim() });
    if (existing) return res.status(400).json({ message: 'اليوزرنيم ده مستخدم قبل كده' });

    const cashierCount = await Cashier.countDocuments();

    if (cashierCount > 0) {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(403).json({ message: 'يرجى تسجيل الدخول أولاً لإضافة كاشير جديد' });
      }
      const token = authHeader.split(' ')[1];
      try {
        jwt.verify(token, JWT_SECRET);
      } catch {
        return res.status(401).json({ message: 'الجلسة منتهية، يرجى إعادة تسجيل الدخول' });
      }
    }

    const assignedRole = cashierCount === 0 ? 'admin' : (role || 'cashier');
    // Only set shiftType for cashiers; admins/trainers have no shift restriction
    const assignedShiftType = assignedRole === 'cashier' ? (shiftType || undefined) : undefined;

    const hashed = await bcrypt.hash(password, 10);
    const cashier = await Cashier.create({
      name,
      username: username.trim(),
      password: hashed,
      role: assignedRole,
      shiftType: assignedShiftType,
    });

    res.status(201).json({
      id: cashier._id,
      name: cashier.name,
      username: cashier.username,
      role: cashier.role,
      shiftType: cashier.shiftType || null,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getMe = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashier = await Cashier.findById((req as any).cashier.id).select('-password');
    if (!cashier) return res.status(404).json({ message: 'الحساب مش موجود' });
    res.json(cashier);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getAllCashiers = async (req: Request, res: Response): Promise<any> => {
  try {
    const cashiers = await Cashier.find().select('-password').sort({ createdAt: -1 });
    res.json(cashiers);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const updateCashier = async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, role, active, password, shiftType } = req.body;
    const updates: any = {};
    if (name) updates.name = name;
    if (role) updates.role = role;
    if (active !== undefined) updates.active = active;
    if (password) updates.password = await bcrypt.hash(password, 10);
    // Allow updating shiftType; set to undefined if role is admin/trainer
    if (shiftType !== undefined) updates.shiftType = shiftType || undefined;

    const cashier = await Cashier.findByIdAndUpdate(req.params.id, updates, { new: true }).select(
      '-password'
    );
    if (!cashier) return res.status(404).json({ message: 'الكاشير مش موجود' });
    res.json(cashier);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

