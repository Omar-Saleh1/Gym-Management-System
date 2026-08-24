import mongoose, { Schema, Document } from 'mongoose';
import { ICashier } from './Cashier';

export interface IExpense extends Document {
  title: string;
  amount: number;
  category: 'RENT' | 'SALARIES' | 'EQUIPMENT' | 'MAINTENANCE' | 'ELECTRICITY' | 'WATER' | 'MARKETING' | 'OTHER';
  date: Date;
  notes?: string;
  createdBy: mongoose.Types.ObjectId | ICashier;
  createdAt: Date;
  updatedAt: Date;
}

const expenseSchema = new Schema<IExpense>(
  {
    title: { type: String, required: true },
    amount: { type: Number, required: true },
    category: { 
      type: String, 
      enum: ['RENT', 'SALARIES', 'EQUIPMENT', 'MAINTENANCE', 'ELECTRICITY', 'WATER', 'MARKETING', 'OTHER'],
      default: 'OTHER'
    },
    date: { type: Date, default: Date.now },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Cashier', required: true },
  },
  { timestamps: true }
);

expenseSchema.index({ date: -1 });
expenseSchema.index({ category: 1, date: -1 });

export default mongoose.model<IExpense>('Expense', expenseSchema);
