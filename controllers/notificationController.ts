import { Request, Response } from 'express';
import NotificationLog from '../models/NotificationLog';
import { runAllJobsNow } from '../services/scheduler.service';

// ─── Get notification logs ────────────────────────────────────────────────────

export const getLogs = async (req: Request, res: Response): Promise<any> => {
  try {
    const { memberId, type, status, limit = 50 } = req.query;
    const query: any = {};

    if (memberId) query.member = memberId;
    if (type)     query.type   = type;
    if (status)   query.status = status;

    const logs = await NotificationLog.find(query)
      .populate('member', 'name phone')
      .sort({ createdAt: -1 })
      .limit(Number(limit));

    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Get stats ────────────────────────────────────────────────────────────────

export const getStats = async (req: Request, res: Response): Promise<any> => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [total, sent, failed, todayCount] = await Promise.all([
      NotificationLog.countDocuments(),
      NotificationLog.countDocuments({ status: 'sent' }),
      NotificationLog.countDocuments({ status: 'failed' }),
      NotificationLog.countDocuments({ createdAt: { $gte: todayStart } }),
    ]);

    res.json({ total, sent, failed, pending: total - sent - failed, sentToday: todayCount });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Manually trigger daily jobs (admin only) ─────────────────────────────────

export const triggerJobs = async (req: Request, res: Response): Promise<any> => {
  try {
    console.log('[Admin] Manual trigger of daily notification jobs...');
    await runAllJobsNow();
    res.json({ message: '✅ Daily jobs ran successfully' });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
