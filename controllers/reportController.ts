import { Request, Response } from 'express';
import Sale from '../models/Sale';
import Member from '../models/Member';
import Subscription from '../models/Subscription';
import Attendance from '../models/Attendance';

const buildDateRange = (from?: string, to?: string) => {
  const range: any = {};
  if (from) range.$gte = new Date(from);
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    range.$lte = toDate;
  }
  return range;
};

export const getDashboard = async (req: Request, res: Response): Promise<any> => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const soon = new Date();
    soon.setDate(soon.getDate() + 7);

    const [todaySales, totalMembers, activeSubscriptions, expiringSoon, todayAttendance] =
      await Promise.all([
        Sale.find({ createdAt: { $gte: today, $lt: tomorrow } }),
        Member.countDocuments({ active: true }),
        Subscription.countDocuments({ status: 'active', endDate: { $gte: new Date() } }),
        Subscription.countDocuments({
          status: 'active',
          endDate: { $gte: new Date(), $lte: soon },
        }),
        Attendance.countDocuments({ checkInTime: { $gte: today, $lt: tomorrow } }),
      ]);

    const todayRevenue = todaySales.reduce((sum, s) => sum + s.total, 0);

    res.json({
      todayRevenue,
      todaySalesCount: todaySales.length,
      totalMembers,
      activeSubscriptions,
      expiringSoon,
      todayAttendance,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getSalesReport = async (req: Request, res: Response): Promise<any> => {
  try {
    const { from, to } = req.query;
    const query: any = {};
    if (from || to) query.createdAt = buildDateRange(from as string, to as string);

    const sales = await Sale.find(query).populate('cashier', 'name');

    const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);
    const totalCost = sales.reduce((sum, s) => sum, 0);

    const productCounts: Record<string, { qty: number; revenue: number }> = {};
    sales.forEach((sale) => {
      sale.items.forEach((item) => {
        if (!productCounts[item.name]) {
          productCounts[item.name] = { qty: 0, revenue: 0 };
        }
        productCounts[item.name].qty += item.quantity;
        productCounts[item.name].revenue += item.price * item.quantity;
      });
    });

    const topProducts = Object.entries(productCounts)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);

    const paymentBreakdown = sales.reduce((acc: any, s) => {
      acc[s.paymentMethod] = (acc[s.paymentMethod] || 0) + s.total;
      return acc;
    }, {});

    res.json({
      totalRevenue,
      salesCount: sales.length,
      topProducts,
      paymentBreakdown,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getSubscriptionsReport = async (req: Request, res: Response): Promise<any> => {
  try {
    const { from, to } = req.query;
    const query: any = {};
    if (from || to) query.createdAt = buildDateRange(from as string, to as string);

    const subscriptions = await Subscription.find(query)
      .populate('member', 'name phone')
      .populate('plan', 'name price');

    const totalRevenue = subscriptions.reduce((sum, s) => sum + s.pricePaid, 0);

    const statusBreakdown = subscriptions.reduce((acc: any, s) => {
      acc[s.status] = (acc[s.status] || 0) + 1;
      return acc;
    }, {});

    res.json({
      totalRevenue,
      count: subscriptions.length,
      statusBreakdown,
      subscriptions,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getAttendanceReport = async (req: Request, res: Response): Promise<any> => {
  try {
    const { from, to } = req.query;
    const query: any = {};
    if (from || to) query.checkInTime = buildDateRange(from as string, to as string);

    const records = await Attendance.find(query).populate('member', 'name phone');

    const totalVisits = records.length;
    const uniqueMembers = new Set(records.map((r) => String((r.member as any)?._id))).size;

    const completed = records.filter((r) => r.checkOutTime);
    const avgDuration =
      completed.length > 0
        ? Math.round(
            completed.reduce(
              (sum, r) => sum + (r.checkOutTime!.getTime() - r.checkInTime.getTime()) / 1000 / 60,
              0
            ) / completed.length
          )
        : null;

    res.json({
      totalVisits,
      uniqueMembers,
      avgDurationMinutes: avgDuration,
      completedSessions: completed.length,
      openSessions: totalVisits - completed.length,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getDailyFinancialReport = async (req: Request, res: Response): Promise<any> => {
  try {
    const { date } = req.query;
    
    // Default to today if no date provided
    let targetDate = new Date();
    if (date) {
      targetDate = new Date(date as string);
    }
    
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const query = { createdAt: { $gte: targetDate, $lt: nextDay } };

    const [subscriptions, sales] = await Promise.all([
      Subscription.find(query).populate('plan', 'name'),
      Sale.find(query).populate('items.product', 'category')
    ]);

    let subscriptionsRevenue = 0;
    let sessionsRevenue = 0;

    subscriptions.forEach(sub => {
      const plan = sub.plan as any;
      if (plan && plan.name && (plan.name.includes('حصة') || plan.name.includes('حصه'))) {
        sessionsRevenue += sub.pricePaid;
      } else {
        subscriptionsRevenue += sub.pricePaid;
      }
    });

    let salesRevenue = 0;

    sales.forEach(sale => {
      sale.items.forEach(item => {
        const product = item.product as any;
        const itemTotal = item.price * item.quantity;
        
        // Also check if any product is explicitly a session category just in case
        if (product && (product.category === 'حصص' || product.category === 'sessions' || product.category === 'حصة')) {
          sessionsRevenue += itemTotal;
        } else {
          salesRevenue += itemTotal;
        }
      });
    });

    const totalRevenue = subscriptionsRevenue + salesRevenue + sessionsRevenue;

    res.json({
      subscriptionsRevenue,
      salesRevenue,
      sessionsRevenue,
      totalRevenue,
      date: targetDate.toISOString().split('T')[0]
    });

  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
