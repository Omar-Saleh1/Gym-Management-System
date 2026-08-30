import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthCashier {
  id: string;
  username: string;
  role: 'admin' | 'cashier' | 'trainer';
  name: string;
  shiftType?: 'GIRLS' | 'BOYS'; // undefined = admin/trainer (no shift restriction)
}

/**
 * Returns a MongoDB filter scoped to the cashier's shift.
 * - Admin/Trainer (no shiftType) → {} (sees everything)
 * - GIRLS cashier → { shiftType: 'GIRLS' }
 * - BOYS cashier  → { shiftType: 'BOYS' }
 */
export const getShiftFilter = (cashier: AuthCashier): Record<string, any> => {
  if (!cashier.shiftType || cashier.role === 'admin') return {};
  return { shiftType: cashier.shiftType };
};

/**
 * Returns true if the cashier is allowed to access a record with the given shiftType.
 * Admin is always allowed. Cashier must match.
 */
export const canAccessShift = (cashier: AuthCashier, recordShiftType: string): boolean => {
  if (!cashier.shiftType || cashier.role === 'admin') return true;
  return cashier.shiftType === recordShiftType;
};

export const protect = (req: Request, res: Response, next: NextFunction): any => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'مفيش توكن، الدخول مرفوض' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'change_this_secret_key_in_production') as AuthCashier;
    (req as any).cashier = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'توكن غير صالح' });
  }
};

export const adminOnly = (req: Request, res: Response, next: NextFunction): any => {
  if ((req as any).cashier?.role !== 'admin') {
    return res.status(403).json({ message: 'الصلاحية دي للأدمن بس' });
  }
  next();
};

