import mongoose, { Schema, Document } from 'mongoose';

export interface ICoach extends Document {
  name: string;
  salary: number; // default base salary
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const coachSchema = new Schema<ICoach>(
  {
    name: { type: String, required: true },
    salary: { type: Number, required: true, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model<ICoach>('Coach', coachSchema);
