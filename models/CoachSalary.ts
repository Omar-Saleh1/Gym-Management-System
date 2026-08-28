import mongoose, { Schema, Document } from 'mongoose';
import { ICoach } from './Coach';
import { ICashier } from './Cashier';

export interface ICoachSalary extends Document {
  coach: mongoose.Types.ObjectId | ICoach;
  month: string; // YYYY-MM
  salaryAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: 'PAID' | 'PARTIAL' | 'UNPAID';
  paymentMethod?: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'ONLINE' | 'OTHER';
  paymentDate?: Date;
  notes?: string;
  createdBy: mongoose.Types.ObjectId | ICashier;
  createdAt: Date;
  updatedAt: Date;
}

const coachSalarySchema = new Schema<ICoachSalary>(
  {
    coach: { type: Schema.Types.ObjectId, ref: 'Coach', required: true },
    month: { type: String, required: true }, // e.g. "2026-08"
    salaryAmount: { type: Number, required: true },
    paidAmount: { type: Number, required: true, default: 0 },
    remainingAmount: { type: Number, required: true },
    status: { type: String, enum: ['PAID', 'PARTIAL', 'UNPAID'], default: 'UNPAID' },
    paymentMethod: { type: String, enum: ['CASH', 'CARD', 'BANK_TRANSFER', 'ONLINE', 'OTHER'] },
    paymentDate: { type: Date },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Cashier', required: true },
  },
  { timestamps: true }
);

coachSalarySchema.index({ coach: 1, month: 1 }, { unique: true });

export default mongoose.model<ICoachSalary>('CoachSalary', coachSalarySchema);
