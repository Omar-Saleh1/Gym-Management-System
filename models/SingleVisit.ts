import mongoose, { Schema, Document } from 'mongoose';
import { ICashier } from './Cashier';
import { ITransaction } from './Transaction';

export interface ISingleVisit extends Document {
  name: string;
  phone?: string;
  amount: number;
  paymentMethod: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'ONLINE' | 'OTHER';
  shiftType: 'GIRLS' | 'BOYS';
  createdBy: mongoose.Types.ObjectId | ICashier;
  visitedAt: Date;
  notes?: string;
  transactionId?: mongoose.Types.ObjectId | ITransaction;
  createdAt: Date;
  updatedAt: Date;
}

const singleVisitSchema = new Schema<ISingleVisit>(
  {
    name:          { type: String, required: true, trim: true },
    phone:         { type: String, trim: true, default: '' },
    amount:        { type: Number, required: true, min: 1 },
    paymentMethod: { type: String, enum: ['CASH', 'CARD', 'BANK_TRANSFER', 'ONLINE', 'OTHER'], default: 'CASH' },
    shiftType:     { type: String, enum: ['GIRLS', 'BOYS'], required: true },
    createdBy:     { type: Schema.Types.ObjectId, ref: 'Cashier', required: true },
    visitedAt:     { type: Date, default: Date.now },
    notes:         { type: String, default: '' },
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction' },
  },
  { timestamps: true }
);

singleVisitSchema.index({ visitedAt: -1 });
singleVisitSchema.index({ shiftType: 1, visitedAt: -1 });

export default mongoose.model<ISingleVisit>('SingleVisit', singleVisitSchema);
