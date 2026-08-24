import mongoose, { Schema, Document } from 'mongoose';
import { IMember } from './Member';
import { ICashier } from './Cashier';

export interface IFood {
  name: string;
  quantity?: string;
  unit?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fats?: number;
}

export interface IMeal {
  name: string; // e.g., "Breakfast"
  time?: string;
  foods: IFood[];
  calories?: number;
  protein?: number;
  carbs?: number;
  fats?: number;
  notes?: string;
}

export interface IDietPlan extends Document {
  member: mongoose.Types.ObjectId | IMember;
  trainer: mongoose.Types.ObjectId | ICashier;
  planName: string;
  goal?: string;
  calories?: number;
  protein?: string;
  carbs?: string;
  fats?: string;
  startDate?: Date;
  endDate?: Date;
  meals: IMeal[];
  notes?: string;
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  createdAt: Date;
  updatedAt: Date;
}

const foodSchema = new Schema<IFood>({
  name: { type: String, required: true },
  quantity: { type: String },
  unit: { type: String },
  calories: { type: Number },
  protein: { type: Number },
  carbs: { type: Number },
  fats: { type: Number },
});

const mealSchema = new Schema<IMeal>({
  name: { type: String, required: true },
  time: { type: String },
  foods: [foodSchema],
  calories: { type: Number },
  protein: { type: Number },
  carbs: { type: Number },
  fats: { type: Number },
  notes: { type: String },
});

const dietPlanSchema = new Schema<IDietPlan>(
  {
    member: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
    trainer: { type: Schema.Types.ObjectId, ref: 'Cashier', required: true },
    planName: { type: String, required: true },
    goal: { type: String },
    calories: { type: Number },
    protein: { type: String },
    carbs: { type: String },
    fats: { type: String },
    startDate: { type: Date },
    endDate: { type: Date },
    meals: [mealSchema],
    notes: { type: String },
    status: { type: String, enum: ['ACTIVE', 'COMPLETED', 'ARCHIVED'], default: 'ACTIVE' },
  },
  { timestamps: true }
);

dietPlanSchema.index({ member: 1, status: 1 });

export default mongoose.model<IDietPlan>('DietPlan', dietPlanSchema);
