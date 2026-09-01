import mongoose, { Schema, Document } from 'mongoose';
import { IMember } from './Member';
import { ISubscriptionPlan } from './SubscriptionPlan';
import { ICashier } from './Cashier';

export interface ISubscription extends Document {
  member: mongoose.Types.ObjectId | IMember;
  plan: mongoose.Types.ObjectId | ISubscriptionPlan;
  startDate: Date;
  endDate: Date;
  pricePaid: number;
  paymentMethod: string;
  notes?: string;
  status: 'active' | 'expired' | 'cancelled' | 'frozen';
  subscriptionType: 'days' | 'sessions';
  sessionsLimit: number;
  sessionsUsed: number;
  freezeStartDate?: Date;
  freezeEndDate?: Date;
  createdBy?: mongoose.Types.ObjectId | ICashier;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<ISubscription>(
  {
    member: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
    plan: { type: Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    pricePaid: { type: Number, required: true },
    paymentMethod: { type: String, default: 'cash' },
    notes: { type: String, default: '' },
    status: { type: String, enum: ['active', 'expired', 'cancelled', 'frozen'], default: 'active' },
    subscriptionType: { type: String, enum: ['days', 'sessions'], default: 'days' },
    sessionsLimit: { type: Number, default: 0 },
    sessionsUsed: { type: Number, default: 0 },
    freezeStartDate: { type: Date },
    freezeEndDate: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Cashier' },
  },
  { timestamps: true }
);

export default mongoose.model<ISubscription>('Subscription', subscriptionSchema);

