import mongoose, { Schema, Document } from 'mongoose';
import { IMember } from './Member';

export interface IAttendance extends Document {
  member: mongoose.Types.ObjectId | IMember;
  checkInTime: Date;
  checkOutTime?: Date;
  date: string;           // YYYY-MM-DD for easy daily queries
  qrToken?: string;       // the QR token that was scanned
  method: 'QR' | 'MANUAL' | 'ADMIN';
  status: 'open' | 'completed' | 'CHECKED_IN' | 'CHECKED_OUT';
  shiftType: 'GIRLS' | 'BOYS' | 'unassigned'; // denormalized for fast shift filtering
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
    method:       { type: String, enum: ['QR', 'MANUAL', 'ADMIN'], default: 'QR' },
    status:       { type: String, enum: ['open', 'completed', 'CHECKED_IN', 'CHECKED_OUT'], default: 'open' },
    shiftType:    { type: String, enum: ['GIRLS', 'BOYS', 'unassigned'], default: 'unassigned' },
  },
  { timestamps: true }
);

// Index for fast daily lookups
attendanceSchema.index({ member: 1, date: 1 });
attendanceSchema.index({ date: 1 });
attendanceSchema.index({ shiftType: 1, date: 1 });

export default mongoose.model<IAttendance>('Attendance', attendanceSchema);

