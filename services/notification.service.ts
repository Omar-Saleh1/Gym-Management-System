/**
 * Notification Service
 * --------------------
 * Central service that handles sending notifications and logging them.
 * Prevents duplicate notifications for the same (member + type + reference).
 */

import NotificationLog, { NotificationType } from '../models/NotificationLog';
import { sendWhatsApp, templates } from './whatsapp.service';
import { IMember } from '../models/Member';
import { ISubscription } from '../models/Subscription';

interface SendOptions {
  member:      IMember & { _id: any };
  type:        NotificationType;
  message:     string;
  referenceId?: string;
  metadata?:   Record<string, any>;
}

// ─── Core send with dedup guard ──────────────────────────────────────────────

/**
 * Sends a WhatsApp notification only if it hasn't been sent today
 * for the same (member + type + referenceId).
 */
export async function sendNotification(opts: SendOptions): Promise<boolean> {
  const { member, type, message, referenceId, metadata } = opts;

  if (!member || !member.phone || member.phone.trim() === '') {
    console.log(`[Notification] Skipped (No phone number): ${type} for ${member?.name || 'Unknown'}`);
    return false;
  }

  // Deduplication: don't send the same notification twice today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const alreadySent = await NotificationLog.findOne({
    member:      member._id,
    type,
    referenceId: referenceId || null,
    status:      'sent',
    createdAt:   { $gte: todayStart },
  });

  if (alreadySent) {
    console.log(`[Notification] Skipped duplicate: ${type} for ${member.name}`);
    return false;
  }

  // Create a pending log entry
  const log = await NotificationLog.create({
    member:      member._id,
    type,
    channel:     'whatsapp',
    status:      'pending',
    referenceId: referenceId || undefined,
    metadata,
  });

  // Send
  try {
    await sendWhatsApp(member.phone, message);
    log.status = 'sent';
    log.sentAt  = new Date();
    await log.save();
    console.log(`[Notification] ✅ Sent "${type}" to ${member.name} (${member.phone})`);
    return true;
  } catch (err: any) {
    log.status       = 'failed';
    log.errorMessage = err.message;
    await log.save();
    console.error(`[Notification] ❌ Failed "${type}" for ${member.name}: ${err.message}`);
    return false;
  }
}

// ─── Typed helper functions ───────────────────────────────────────────────────

export async function notifyExpiryIn7Days(member: IMember & { _id: any }, subscription: ISubscription & { _id: any }) {
  const expiryDate = new Date(subscription.endDate).toLocaleDateString('ar-EG');
  return sendNotification({
    member,
    type:        'expiry_7days',
    message:     templates.expiry7Days(member.name, expiryDate),
    referenceId: String(subscription._id),
    metadata:    { endDate: subscription.endDate },
  });
}

export async function notifyExpiryIn3Days(member: IMember & { _id: any }, subscription: ISubscription & { _id: any }) {
  const expiryDate = new Date(subscription.endDate).toLocaleDateString('ar-EG');
  return sendNotification({
    member,
    type:        'expiry_3days',
    message:     templates.expiry3Days(member.name, expiryDate),
    referenceId: String(subscription._id),
    metadata:    { endDate: subscription.endDate },
  });
}

export async function notifyExpiryIn1Day(member: IMember & { _id: any }, subscription: ISubscription & { _id: any }) {
  const expiryDate = new Date(subscription.endDate).toLocaleDateString('ar-EG');
  return sendNotification({
    member,
    type:        'expiry_1day',
    message:     templates.expiry1Day(member.name, expiryDate),
    referenceId: String(subscription._id),
    metadata:    { endDate: subscription.endDate },
  });
}

export async function notifyExpired(member: IMember & { _id: any }, subscription: ISubscription & { _id: any }) {
  return sendNotification({
    member,
    type:        'expired',
    message:     templates.expired(member.name),
    referenceId: String(subscription._id),
  });
}

export async function notifyPaymentSuccess(
  member: IMember & { _id: any; qrToken?: string },
  subscription: ISubscription & { _id: any },
  planName: string,
  isRenewal: boolean = true
) {
  const endDate = new Date(subscription.endDate).toLocaleDateString('ar-EG');
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const qrLink = `${frontendUrl}/member/qr/${member.qrToken || ''}`;

  return sendNotification({
    member: member as any,
    type:        'payment_success',
    message:     isRenewal 
      ? templates.paymentSuccess(member.name, planName, endDate, qrLink)
      : templates.newSubscription(member.name, planName, endDate, qrLink),
    referenceId: String(subscription._id),
  });
}

export async function notifyNewMember(member: IMember & { _id: any }) {
  return sendNotification({
    member,
    type:    'new_membership',
    message: templates.newMembership(member.name),
  });
}

export async function notifyBirthday(member: IMember & { _id: any }) {
  return sendNotification({
    member,
    type:    'birthday',
    message: templates.birthday(member.name),
  });
}

export async function notifySubscriptionFrozen(
  member: IMember & { _id: any },
  subscription: ISubscription & { _id: any }
) {
  const freezeEndDateStr = new Date(subscription.freezeEndDate!).toLocaleDateString('ar-EG');
  return sendNotification({
    member,
    type:        'subscription_frozen',
    message:     templates.subscriptionFrozen(member.name, freezeEndDateStr),
    referenceId: String(subscription._id),
  });
}

export async function notifySubscriptionUnfrozen(
  member: IMember & { _id: any },
  subscription: ISubscription & { _id: any }
) {
  const endDateStr = new Date(subscription.endDate).toLocaleDateString('ar-EG');
  return sendNotification({
    member,
    type:        'subscription_unfrozen',
    message:     templates.subscriptionUnfrozen(member.name, endDateStr),
    referenceId: String(subscription._id),
  });
}
