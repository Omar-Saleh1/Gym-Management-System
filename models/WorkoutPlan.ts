import mongoose, { Schema, Document } from 'mongoose';
import { IMember } from './Member';
import { ICashier } from './Cashier';

export interface IExercise {
  name: string;
  muscleGroup?: string;
  sets?: number;
  reps?: string;
  weight?: string;
  rest?: string;
  notes?: string;
}

export interface IWorkoutDay {
  dayName: string; // e.g., "Day 1: Chest + Triceps"
  exercises: IExercise[];
}

export interface IWorkoutPlan extends Document {
  member: mongoose.Types.ObjectId | IMember;
  trainer: mongoose.Types.ObjectId | ICashier;
  planName: string;
  goal?: string;
  duration?: string;
  startDate?: Date;
  endDate?: Date;
  days: IWorkoutDay[];
  notes?: string;
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  createdAt: Date;
  updatedAt: Date;
}

const exerciseSchema = new Schema<IExercise>({
  name: { type: String, required: true },
  muscleGroup: { type: String },
  sets: { type: Number },
  reps: { type: String },
  weight: { type: String },
  rest: { type: String },
  notes: { type: String },
});

const workoutDaySchema = new Schema<IWorkoutDay>({
  dayName: { type: String, required: true },
  exercises: [exerciseSchema],
});

const workoutPlanSchema = new Schema<IWorkoutPlan>(
  {
    member: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
    trainer: { type: Schema.Types.ObjectId, ref: 'Cashier', required: true },
    planName: { type: String, required: true },
    goal: { type: String },
    duration: { type: String },
    startDate: { type: Date },
    endDate: { type: Date },
    days: [workoutDaySchema],
    notes: { type: String },
    status: { type: String, enum: ['ACTIVE', 'COMPLETED', 'ARCHIVED'], default: 'ACTIVE' },
  },
  { timestamps: true }
);

workoutPlanSchema.index({ member: 1, status: 1 });

export default mongoose.model<IWorkoutPlan>('WorkoutPlan', workoutPlanSchema);
