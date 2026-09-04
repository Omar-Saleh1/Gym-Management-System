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
  shiftType: 'GIRLS' | 'BOYS' | 'unassigned'; // shift isolation
  qrToken: string;      // unique QR token
  isQrActive: boolean;  // whether the QR token is currently valid/enabled
  createdAt: Date;
  updatedAt: Date;
}

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function generateShortToken(length = 12): string {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += BASE62_CHARS[bytes[i] % 62];
  }
  return result;
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
    shiftType:   { type: String, enum: ['GIRLS', 'BOYS', 'unassigned'], default: 'unassigned' },
    isQrActive:  { type: Boolean, default: true },
    qrToken:     { type: String, unique: true, default: () => generateShortToken(12) },
  },
  { timestamps: true }
);

memberSchema.index({ shiftType: 1, active: 1 });

export default mongoose.model<IMember>('Member', memberSchema);

