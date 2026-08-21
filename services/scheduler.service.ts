/**
 * Scheduler Service (Cron Jobs)
 * ─────────────────────────────
 * Runs daily at 9:00 AM (Cairo time / UTC+3 → 06:00 UTC).
 *
 * Jobs:
 *  1. Expiry reminders (7 days, 3 days, 1 day, expired)
 *  2. Birthday greetings
 */

import cron from 'node-cron';
import Subscription from '../models/Subscription';
import Member from '../models/Member';
import {
  notifyExpiryIn7Days,
  notifyExpiryIn3Days,
  notifyExpiryIn1Day,
  notifyExpired,
  notifyBirthday,
  notifySubscriptionUnfrozen,
} from './notification.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a Date at midnight (00:00:00) N days from today */
function daysFromNow(n: number): { start: Date; end: Date } {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  const start = new Date(d);
  const end   = new Date(d);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// ─── Job: Expiry reminders ────────────────────────────────────────────────────

async function runExpiryReminders() {
  console.log('[Scheduler] 🔔 Running expiry reminders...');

  const targets = [
    { days: 7,  fn: notifyExpiryIn7Days },
    { days: 3,  fn: notifyExpiryIn3Days },
    { days: 1,  fn: notifyExpiryIn1Day  },
    { days: 0,  fn: notifyExpired       }, // expired today (endDate = today)
  ];

  let totalSent = 0;

  for (const { days, fn } of targets) {
    const { start, end } = daysFromNow(days);

    const subs = await Subscription.find({
      status:  days === 0 ? 'expired' : 'active',
      endDate: { $gte: start, $lte: end },
    }).populate<{ member: any }>('member');

    for (const sub of subs) {
      if (!sub.member || !sub.member.active) continue;
      const sent = await fn(sub.member, sub as any);
      if (sent) totalSent++;
    }
  }

  console.log(`[Scheduler] ✅ Expiry reminders done. Sent: ${totalSent}`);
}

// ─── Job: Birthday greetings ──────────────────────────────────────────────────

async function runBirthdayGreetings() {
  console.log('[Scheduler] 🎂 Running birthday greetings...');

  const today = new Date();
  const month = today.getMonth() + 1; // 1-12
  const day   = today.getDate();

  // Use aggregation to filter by month+day regardless of year
  const members = await Member.aggregate([
    {
      $match: {
        active:      true,
        dateOfBirth: { $exists: true, $ne: null },
      },
    },
    {
      $addFields: {
        birthMonth: { $month: '$dateOfBirth' },
        birthDay:   { $dayOfMonth: '$dateOfBirth' },
      },
    },
    {
      $match: { birthMonth: month, birthDay: day },
    },
  ]);

  let totalSent = 0;
  for (const member of members) {
    const sent = await notifyBirthday(member as any);
    if (sent) totalSent++;
  }

  console.log(`[Scheduler] ✅ Birthday greetings done. Sent: ${totalSent}`);
}

async function runAutoUnfreeze() {
  console.log('[Scheduler] ❄️ Checking for expired frozen subscriptions...');

  const today = new Date();

  // Find frozen subscriptions that have reached or passed their freezeEndDate
  const frozenSubs = await Subscription.find({
    status:        'frozen',
    freezeEndDate: { $lte: today },
  }).populate<{ member: any }>('member');

  let totalUnfrozen = 0;

  for (const sub of frozenSubs) {
    const start = sub.freezeStartDate ? new Date(sub.freezeStartDate) : new Date();
    const end = sub.freezeEndDate ? new Date(sub.freezeEndDate) : new Date();
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const frozenDays = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)));

    const newEnd = new Date(sub.endDate);
    newEnd.setDate(newEnd.getDate() + frozenDays);

    sub.endDate = newEnd;
    sub.status = 'active';
    sub.freezeStartDate = undefined;
    sub.freezeEndDate = undefined;
    await sub.save();

    if (sub.member && sub.member.active) {
      notifySubscriptionUnfrozen(sub.member, sub as any).catch(err => {
        console.error('[Scheduler] Failed to send WhatsApp notification on auto-unfreeze:', err);
      });
    }
    totalUnfrozen++;
  }

  console.log(`[Scheduler] ✅ Auto-unfreeze done. Unfrozen: ${totalUnfrozen}`);
}

// ─── Register cron jobs ───────────────────────────────────────────────────────

export function initScheduler() {
  // Run every day at 09:00 AM Cairo time (= 06:00 UTC)
  // Cron format: minute hour day month weekday
  cron.schedule('0 6 * * *', async () => {
    console.log('\n[Scheduler] ⏰ Daily jobs starting...');
    try {
      await runAutoUnfreeze();
      await runExpiryReminders();
      await runBirthdayGreetings();
    } catch (err) {
      console.error('[Scheduler] ❌ Error in daily jobs:', err);
    }
  }, { timezone: 'UTC' });

  console.log('[Scheduler] ✅ Cron jobs registered (daily at 09:00 Cairo time)');
}

// ─── Manual trigger (for testing via API) ────────────────────────────────────

export async function runAllJobsNow() {
  await runAutoUnfreeze();
  await runExpiryReminders();
  await runBirthdayGreetings();
}
