import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'crypto';


export interface IMember extends Document {
  name: string;
  phone: string;
  email?: string;
  gender: 'male' | 'female';
  dateOfBirth?: Date;
  address?: string;
  photo?: string;
  notes?: string;
  active: boolean;
  qrToken: string;      // unique QR token
  createdAt: Date;
  updatedAt: Date;
}

const memberSchema = new Schema<IMember>(
  {
    name:        { type: String, required: true },
    phone:       { type: String, required: true },
    email:       { type: String },
    gender:      { type: String, enum: ['male', 'female'], default: 'male' },
    dateOfBirth: { type: Date },
    address:     { type: String },
    photo:       { type: String },
    notes:       { type: String },
    active:      { type: Boolean, default: true },
    qrToken:     { type: String, unique: true, default: () => `GYM-${crypto.randomUUID().slice(0, 10).toUpperCase()}` },
  },
  { timestamps: true }
);

export default mongoose.model<IMember>('Member', memberSchema);
