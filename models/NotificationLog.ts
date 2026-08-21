import mongoose, { Schema, Document } from 'mongoose';
import { IMember } from './Member';

export type NotificationType =
  | 'expiry_7days'
  | 'expiry_3days'
  | 'expiry_1day'
  | 'expired'
  | 'payment_success'
  | 'new_membership'
  | 'membership_renewal'
  | 'absent_reminder'
  | 'birthday'
  | 'subscription_frozen'
  | 'subscription_unfrozen';

export interface INotificationLog extends Document {
  member:           mongoose.Types.ObjectId | IMember;
  type:             NotificationType;
  channel:          'whatsapp' | 'sms' | 'email';
  status:           'pending' | 'sent' | 'failed';
  sentAt?:          Date;
  errorMessage?:    string;
  referenceId?:     string;  // e.g., subscriptionId that triggered this
  metadata?:        Record<string, any>;
  createdAt:        Date;
  updatedAt:        Date;
}

const notificationLogSchema = new Schema<INotificationLog>(
  {
    member:        { type: Schema.Types.ObjectId, ref: 'Member', required: true },
    type:          { type: String, required: true },
    channel:       { type: String, enum: ['whatsapp', 'sms', 'email'], default: 'whatsapp' },
    status:        { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    sentAt:        { type: Date },
    errorMessage:  { type: String },
    referenceId:   { type: String },
    metadata:      { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

// Prevent sending the same notification type for the same member+reference twice per day
notificationLogSchema.index(
  { member: 1, type: 1, referenceId: 1, createdAt: 1 },
  { unique: false }
);

export default mongoose.model<INotificationLog>('NotificationLog', notificationLogSchema);
