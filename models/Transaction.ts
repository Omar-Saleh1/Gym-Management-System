import mongoose, { Schema, Document } from 'mongoose';
import { IMember } from './Member';
import { ISubscription } from './Subscription';
import { IPayment } from './Payment';
import { ICashier } from './Cashier';

export interface ITransaction extends Document {
  type: 'income' | 'expense';
  category: 'subscription' | 'renewal' | 'coach_salary' | 'rent' | 'equipment' | 'electricity' | 'water' | 'maintenance' | 'other';
  amount: number;
  date: Date;
  memberId?: mongoose.Types.ObjectId | IMember;
  subscriptionId?: mongoose.Types.ObjectId | ISubscription;
  paymentId?: mongoose.Types.ObjectId | IPayment;
  coachId?: mongoose.Types.ObjectId; // We will refer to Coach model
  coachSalaryId?: mongoose.Types.ObjectId; // We will refer to CoachSalary model
  paymentMethod: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'ONLINE' | 'OTHER';
  description?: string;
  notes?: string;
  createdBy: mongoose.Types.ObjectId | ICashier;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    type: { type: String, enum: ['income', 'expense'], required: true },
    category: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, default: Date.now },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member' },
    subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription' },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment' },
    coachId: { type: Schema.Types.ObjectId, ref: 'Coach' },
    coachSalaryId: { type: Schema.Types.ObjectId, ref: 'CoachSalary' },
    paymentMethod: { type: String, enum: ['CASH', 'CARD', 'BANK_TRANSFER', 'ONLINE', 'OTHER'], required: true },
    description: { type: String },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Cashier', required: true },
  },
  { timestamps: true }
);

transactionSchema.index({ date: -1 });
transactionSchema.index({ type: 1, date: -1 });

export default mongoose.model<ITransaction>('Transaction', transactionSchema);
