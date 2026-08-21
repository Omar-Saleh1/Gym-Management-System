import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const protect = (req: Request, res: Response, next: NextFunction): any => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'مفيش توكن، الدخول مرفوض' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'change_this_secret_key_in_production');
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
