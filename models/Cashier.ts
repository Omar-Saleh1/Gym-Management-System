import mongoose, { Schema, Document } from 'mongoose';

export interface ICashier extends Document {
  name: string;
  username: string;
  password?: string;
  role: 'admin' | 'cashier' | 'trainer';
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const cashierSchema = new Schema<ICashier>(
  {
    name: { type: String, required: true },
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'cashier', 'trainer'], default: 'cashier' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model<ICashier>('Cashier', cashierSchema);
