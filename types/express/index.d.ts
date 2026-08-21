import { JwtPayload } from 'jsonwebtoken';

declare global {
  namespace Express {
    interface Request {
      cashier?: {
        id: string;
        username: string;
        role: string;
        name: string;
      } | JwtPayload;
    }
  }
}
