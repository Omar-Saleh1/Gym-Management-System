import mongoose, { Schema, Document } from 'mongoose';

export interface ISubscriptionPlan extends Document {
  name: string;
  durationInDays: number;
  sessionsLimit?: number;
  subscriptionType: 'days' | 'sessions';
  shiftType: 'GIRLS' | 'BOYS' | 'BOTH';
  price: number;
  description?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionPlanSchema = new Schema<ISubscriptionPlan>(
  {
    name: { type: String, required: true },
    durationInDays: { type: Number, required: true },
    sessionsLimit: { type: Number, default: 0 },
    subscriptionType: { type: String, enum: ['days', 'sessions'], default: 'days' },
    shiftType: { type: String, enum: ['GIRLS', 'BOYS', 'BOTH'], default: 'BOTH' },
    price: { type: Number, required: true },
    description: { type: String },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model<ISubscriptionPlan>('SubscriptionPlan', subscriptionPlanSchema);
