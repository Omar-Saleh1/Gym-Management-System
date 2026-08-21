import mongoose, { Schema, Document } from 'mongoose';
import { IMember } from './Member';

export interface IAttendance extends Document {
  member: mongoose.Types.ObjectId | IMember;
  checkInTime: Date;
  checkOutTime?: Date;
  date: string;           // YYYY-MM-DD for easy daily queries
  qrToken?: string;       // the QR token that was scanned
  status: 'open' | 'completed';
  createdAt: Date;
  updatedAt: Date;
}

const attendanceSchema = new Schema<IAttendance>(
  {
    member:       { type: Schema.Types.ObjectId, ref: 'Member', required: true },
    checkInTime:  { type: Date, default: Date.now },
    checkOutTime: { type: Date },
    date:         { type: String, required: true },   // "2026-08-20"
    qrToken:      { type: String },
    status:       { type: String, enum: ['open', 'completed'], default: 'open' },
  },
  { timestamps: true }
);

// Index for fast daily lookups
attendanceSchema.index({ member: 1, date: 1 });
attendanceSchema.index({ date: 1 });

export default mongoose.model<IAttendance>('Attendance', attendanceSchema);
