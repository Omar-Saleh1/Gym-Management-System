import mongoose, { Schema, Document } from 'mongoose';
import { IMember } from './Member';
import { ISubscription } from './Subscription';
import { ICashier } from './Cashier';

export interface IPayment extends Document {
  member: mongoose.Types.ObjectId | IMember;
  subscription?: mongoose.Types.ObjectId | ISubscription;
  amount: number;
  paymentMethod: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'ONLINE' | 'OTHER';
  status: 'PAID' | 'PARTIAL' | 'PENDING' | 'REFUNDED';
  paidAmount: number;
  remainingAmount: number;
  paymentDate: Date;
  notes?: string;
  createdBy: mongoose.Types.ObjectId | ICashier;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    member: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
    subscription: { type: Schema.Types.ObjectId, ref: 'Subscription' },
    amount: { type: Number, required: true },
    paymentMethod: { type: String, enum: ['CASH', 'CARD', 'BANK_TRANSFER', 'ONLINE', 'OTHER'], default: 'CASH' },
    status: { type: String, enum: ['PAID', 'PARTIAL', 'PENDING', 'REFUNDED'], default: 'PAID' },
    paidAmount: { type: Number, required: true },
    remainingAmount: { type: Number, required: true },
    paymentDate: { type: Date, default: Date.now },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Cashier', required: true },
  },
  { timestamps: true }
);

paymentSchema.index({ member: 1, paymentDate: -1 });
paymentSchema.index({ paymentDate: -1 });

export default mongoose.model<IPayment>('Payment', paymentSchema);
