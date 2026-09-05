import { Request, Response } from 'express';
import Sale from '../models/Sale';
import Member from '../models/Member';
import Subscription from '../models/Subscription';
import Attendance from '../models/Attendance';
import Expense from '../models/Expense';
import CoachSalary from '../models/CoachSalary';
import Transaction from '../models/Transaction';
import Payment from '../models/Payment';
import SingleVisit from '../models/SingleVisit';
import { getShiftFilter, AuthCashier } from '../middleware/auth';
import { getBusinessDayBounds, getBusinessDateString, toCairoUtc } from '../utils/businessDay';


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
    const cashier: AuthCashier = (req as any).cashier;
    const { startUtc, endUtc } = getBusinessDayBounds();

    const soon = new Date();
    soon.setDate(soon.getDate() + 7);

    const shiftFilter = getShiftFilter(cashier);
    let memberFilter: any = {};
    if (Object.keys(shiftFilter).length > 0) {
      const shiftMembers = await Member.find({ ...shiftFilter }).select('_id');
      memberFilter = { member: { $in: shiftMembers.map(m => m._id) } };
    }

    const visitShiftFilter = cashier?.role !== 'admin' && cashier?.shiftType ? { shiftType: cashier.shiftType } : {};

    const [todaySales, totalMembers, activeSubscriptions, expiringSoon, todayAttendance, todaySingleVisits] =
      await Promise.all([
        Sale.find({ createdAt: { $gte: startUtc, $lte: endUtc }, ...(cashier?.id ? { cashier: cashier.id } : {}) }),
        Member.countDocuments({ active: true, ...shiftFilter }),
        Subscription.countDocuments({ status: 'active', endDate: { $gte: new Date() }, ...memberFilter }),
        Subscription.countDocuments({
          status: 'active',
          endDate: { $gte: new Date(), $lte: soon },
          ...memberFilter,
        }),
        Attendance.countDocuments({ checkInTime: { $gte: startUtc, $lte: endUtc }, ...shiftFilter }),
        SingleVisit.find({ visitedAt: { $gte: startUtc, $lte: endUtc }, ...visitShiftFilter }),
      ]);

    const todayRevenue = todaySales.reduce((sum, s) => sum + s.total, 0);
    const todaySingleVisitsRevenue = todaySingleVisits.reduce((sum, v) => sum + (v.amount || 0), 0);

    res.json({
      todayRevenue,
      todaySalesCount: todaySales.length,
      todaySingleVisitsCount: todaySingleVisits.length,
      todaySingleVisitsRevenue,
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

const cleanupOrphanedFinancials = async () => {
  try {
    const existingSubIds = await Subscription.distinct('_id');
    await Promise.all([
      Transaction.deleteMany({
        subscriptionId: { $exists: true, $ne: null, $nin: existingSubIds }
      }),
      Payment.deleteMany({
        subscription: { $exists: true, $ne: null, $nin: existingSubIds }
      })
    ]);
  } catch (err) {
    console.error('Failed to cleanup orphaned financials:', err);
  }
};

// ─── Monthly Report ───────────────────────────────────────────────────────────
// GET /reports/monthly?year=2026&month=8&shiftType=GIRLS
export const getMonthlyReport = async (req: Request, res: Response): Promise<any> => {
  try {
    await cleanupOrphanedFinancials();
    const cashier: AuthCashier = (req as any).cashier;
    const activeShift = cashier?.role === 'admin'
      ? (req.query.shiftType as string) || null
      : (cashier?.shiftType || null);

    const now = new Date();
    const year  = parseInt(req.query.year  as string) || now.getFullYear();
    const month = parseInt(req.query.month as string) || (now.getMonth() + 1); // 1-based

    // Build UTC-safe month boundaries (Cairo = UTC+2/+3 – using local Date arithmetic)
    const startLocal = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endLocal   = new Date(year, month,     0, 23, 59, 59, 999); // last day of month

    const toUtc = (d: Date) => {
      const temp = new Date(d.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
      return new Date(d.getTime() - (temp.getTime() - d.getTime()));
    };
    const startUtc = toUtc(startLocal);
    const endUtc   = toUtc(endLocal);

    const monthStr = `${year}-${String(month).padStart(2, '0')}`; // "2026-08"
    const cashierId = req.query.cashierId as string;

    // Shift scoping: find member IDs belonging to active shift
    let shiftMemberIds: any[] | null = null;
    if (activeShift && (activeShift === 'GIRLS' || activeShift === 'BOYS')) {
      const shiftMembers = await Member.find({ shiftType: activeShift }).select('_id');
      shiftMemberIds = shiftMembers.map(m => m._id);
    }

    const txMatch: any = { date: { $gte: startUtc, $lte: endUtc } };
    const subMatch: any = { createdAt: { $gte: startUtc, $lte: endUtc } };
    const saleMatch: any = { createdAt: { $gte: startUtc, $lte: endUtc } };
    const attendanceMatch: any = { checkInTime: { $gte: startUtc, $lte: endUtc } };
    const memberMatch: any = { createdAt: { $gte: startUtc, $lte: endUtc } };
    const singleVisitMatch: any = { visitedAt: { $gte: startUtc, $lte: endUtc } };

    if (shiftMemberIds) {
      txMatch.$or = [
        { memberId: { $in: shiftMemberIds } },
        { shiftType: activeShift },
      ];
      subMatch.member = { $in: shiftMemberIds };
    }
    if (activeShift && (activeShift === 'GIRLS' || activeShift === 'BOYS')) {
      attendanceMatch.shiftType = activeShift;
      memberMatch.shiftType = activeShift;
      singleVisitMatch.shiftType = activeShift;
    }

    if (cashierId) {
      txMatch.createdBy = cashierId;
      subMatch.createdBy = cashierId;
      saleMatch.cashier = cashierId;
      singleVisitMatch.createdBy = cashierId;
    }

    // ── Parallel queries ──────────────────────────────────────────────────────
    const [
      transactions,
      subscriptions,
      newMembers,
      attendanceRecords,
      expenses,
      coachSalaries,
      sales,
      singleVisits,
    ] = await Promise.all([
      // All transactions in the month
      Transaction.find(txMatch)
        .populate('memberId', 'name')
        .populate('coachId', 'name')
        .sort({ date: 1 }),
      // Subscriptions created this month
      Subscription.find(subMatch)
        .populate('member', 'name phone')
        .populate('plan', 'name price'),
      // New members registered this month
      Member.find(memberMatch).select('name phone createdAt'),
      // Attendance this month
      Attendance.find(attendanceMatch)
        .populate('member', 'name phone')
        .sort({ checkInTime: 1 }),
      // Expenses this month
      Expense.find(txMatch.createdBy ? { createdBy: cashierId, date: { $gte: startUtc, $lte: endUtc } } : { date: { $gte: startUtc, $lte: endUtc } }),
      // Coach salaries for this month
      CoachSalary.find({ month: monthStr }).populate('coach', 'name'),
      // Cashier sales this month
      Sale.find(saleMatch),
      // Single visits this month
      SingleVisit.find(singleVisitMatch).populate('createdBy', 'name'),
    ]);

    // ── Financial Summary ─────────────────────────────────────────────────────
    const totalIncome  = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const totalExpense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const netProfit    = totalIncome - totalExpense;

    // ── Income breakdown by category ──────────────────────────────────────────
    const incomeByCategory: Record<string, number> = {};
    transactions.filter(t => t.type === 'income').forEach(t => {
      incomeByCategory[t.category] = (incomeByCategory[t.category] || 0) + t.amount;
    });

    // ── Expense breakdown by category ─────────────────────────────────────────
    const expenseByCategory: Record<string, number> = {};
    transactions.filter(t => t.type === 'expense').forEach(t => {
      expenseByCategory[t.category] = (expenseByCategory[t.category] || 0) + t.amount;
    });
    // Also from Expense model (legacy)
    expenses.forEach(e => {
      const key = e.category.toLowerCase();
      expenseByCategory[key] = (expenseByCategory[key] || 0) + e.amount;
    });

    // ── Daily income chart (day 1 → last day of month) ─────────────────────
    const daysInMonth = endLocal.getDate();
    const dailyIncome: { day: number; income: number; expense: number }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStart = new Date(year, month - 1, d, 0, 0, 0, 0);
      const dayEnd   = new Date(year, month - 1, d, 23, 59, 59, 999);
      const dayStartUtc = toUtc(dayStart);
      const dayEndUtc   = toUtc(dayEnd);

      const dayInc = transactions
        .filter(t => t.type === 'income' && t.date >= dayStartUtc && t.date <= dayEndUtc)
        .reduce((s, t) => s + t.amount, 0);
      const dayExp = transactions
        .filter(t => t.type === 'expense' && t.date >= dayStartUtc && t.date <= dayEndUtc)
        .reduce((s, t) => s + t.amount, 0);

      dailyIncome.push({ day: d, income: dayInc, expense: dayExp });
    }

    // ── Subscriptions ─────────────────────────────────────────────────────────
    const subscriptionRevenue = subscriptions.reduce((s, sub) => s + sub.pricePaid, 0);
    const subStatusBreakdown  = subscriptions.reduce((acc: any, s) => {
      acc[s.status] = (acc[s.status] || 0) + 1;
      return acc;
    }, {});

    // ── Attendance ────────────────────────────────────────────────────────────
    const totalVisits    = attendanceRecords.length;
    const uniqueVisitors = new Set(attendanceRecords.map(r => String((r.member as any)?._id))).size;
    const avgDailyVisits = daysInMonth > 0 ? Math.round(totalVisits / daysInMonth) : 0;

    // ── Top payers (from income transactions grouped by memberId) ─────────────
    const memberTotals: Record<string, { name: string; total: number }> = {};
    transactions.filter(t => t.type === 'income' && t.memberId).forEach(t => {
      const m = t.memberId as any;
      const id = String(m?._id || m);
      if (!memberTotals[id]) memberTotals[id] = { name: m?.name || 'غير معروف', total: 0 };
      memberTotals[id].total += t.amount;
    });
    const topPayers = Object.values(memberTotals)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // ── Sales (cashier) ───────────────────────────────────────────────────────
    const salesRevenue = sales.reduce((s, sale) => s + sale.total, 0);

    // ── Coach Salaries ────────────────────────────────────────────────────────
    const totalSalariesDue  = coachSalaries.reduce((s, cs) => s + cs.salaryAmount, 0);
    const totalSalariesPaid = coachSalaries.reduce((s, cs) => s + cs.paidAmount, 0);

    // ─────────────────────────────────────────────────────────────────────────
    res.status(200).json({
      success: true,
      data: {
        period: { year, month, monthStr, daysInMonth },
        shiftType: activeShift,
        financial: { totalIncome, totalExpense, netProfit, salesRevenue, subscriptionRevenue },
        incomeByCategory,
        expenseByCategory,
        dailyChart: dailyIncome,
        subscriptions: {
          count: subscriptions.length,
          revenue: subscriptionRevenue,
          statusBreakdown: subStatusBreakdown,
          list: subscriptions,
        },
        singleVisits: {
          count: singleVisits.length,
          revenue: singleVisits.reduce((acc, v) => acc + (v.amount || 0), 0),
          list: singleVisits,
        },
        members: {
          newCount: newMembers.length,
          list: newMembers,
        },
        attendance: {
          totalVisits,
          uniqueVisitors,
          avgDailyVisits,
        },
        coachSalaries: {
          totalDue: totalSalariesDue,
          totalPaid: totalSalariesPaid,
          list: coachSalaries,
        },
      }
    });

  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Daily Report ──────────────────────────────────────────────────────────────
// GET /reports/daily?date=2026-08-28&shiftType=GIRLS
export const getDailyReport = async (req: Request, res: Response): Promise<any> => {
  try {
    await cleanupOrphanedFinancials();
    const cashier: AuthCashier = (req as any).cashier;
    const activeShift = cashier?.role === 'admin'
      ? (req.query.shiftType as string) || null
      : (cashier?.shiftType || null);

    const dateParam = req.query.date as string;
    const { startUtc, endUtc, dateStr } = getBusinessDayBounds(dateParam);

    const cashierId = req.query.cashierId as string;

    // Shift scoping: find member IDs belonging to active shift
    let shiftMemberIds: any[] | null = null;
    if (activeShift && (activeShift === 'GIRLS' || activeShift === 'BOYS')) {
      const shiftMembers = await Member.find({ shiftType: activeShift }).select('_id');
      shiftMemberIds = shiftMembers.map(m => m._id);
    }

    const txMatch: any = { date: { $gte: startUtc, $lte: endUtc } };
    const paymentMatch: any = { paymentDate: { $gte: startUtc, $lte: endUtc } };
    const subMatch: any = {
      $or: [
        { startDate: { $gte: startUtc, $lte: endUtc } },
        { createdAt: { $gte: startUtc, $lte: endUtc } },
      ],
    };
    const attendanceMatch: any = { checkInTime: { $gte: startUtc, $lte: endUtc } };
    const memberMatch: any = { createdAt: { $gte: startUtc, $lte: endUtc } };
    const singleVisitMatch: any = { visitedAt: { $gte: startUtc, $lte: endUtc } };

    if (shiftMemberIds) {
      txMatch.$or = [
        { memberId: { $in: shiftMemberIds } },
        { shiftType: activeShift },
      ];
      subMatch.member = { $in: shiftMemberIds };
      paymentMatch.member = { $in: shiftMemberIds };
    }
    if (activeShift && (activeShift === 'GIRLS' || activeShift === 'BOYS')) {
      attendanceMatch.shiftType = activeShift;
      memberMatch.shiftType = activeShift;
      singleVisitMatch.shiftType = activeShift;
    }

    if (cashierId) {
      txMatch.createdBy = cashierId;
      paymentMatch.createdBy = cashierId;
      subMatch.createdBy = cashierId;
      singleVisitMatch.createdBy = cashierId;
    }

    // ── Parallel queries ──────────────────────────────────────────────────────
    const [
      transactions,
      subscriptions,
      attendanceRecords,
      newMembers,
      settledPayments,
      singleVisits,
    ] = await Promise.all([
      // All transactions for this day
      Transaction.find(txMatch)
        .populate('memberId', 'name phone')
        .populate('coachId', 'name')
        .populate('createdBy', 'name')
        .sort({ date: -1 }),
      // Subscriptions created today
      Subscription.find(subMatch)
        .populate('member', 'name phone')
        .populate('plan', 'name price'),
      // Attendance today
      Attendance.find(attendanceMatch)
        .populate('member', 'name phone')
        .sort({ checkInTime: -1 }),
      // New members registered today
      Member.find(memberMatch).select('name phone'),
      // Payments that were SETTLED (fully or partially) today — paymentDate updated today
      Payment.find(paymentMatch)
        .populate('member', 'name phone')
        .populate('createdBy', 'name')
        .sort({ paymentDate: -1 }),
      // Single visits today
      SingleVisit.find(singleVisitMatch)
        .populate('createdBy', 'name')
        .sort({ visitedAt: -1 }),
    ]);

    // ── Financials ────────────────────────────────────────────────────────────
    const totalIncome  = transactions.filter((t: any) => t.type === 'income').reduce((s: number, t: any) => s + t.amount, 0);
    const totalExpense = transactions.filter((t: any) => t.type === 'expense').reduce((s: number, t: any) => s + t.amount, 0);
    const netProfit    = totalIncome - totalExpense;

    // Single visits revenue
    const singleVisitsRevenue = singleVisits.reduce((sum, v) => sum + (v.amount || 0), 0);

    // Income breakdown by category
    const incomeByCategory: Record<string, number> = {};
    transactions.filter((t: any) => t.type === 'income').forEach((t: any) => {
      incomeByCategory[t.category] = (incomeByCategory[t.category] || 0) + t.amount;
    });

    // Expense breakdown
    const expenseByCategory: Record<string, number> = {};
    transactions.filter((t: any) => t.type === 'expense').forEach((t: any) => {
      expenseByCategory[t.category] = (expenseByCategory[t.category] || 0) + t.amount;
    });

    // ── Attendance ────────────────────────────────────────────────────────────
    const uniqueVisitors = new Set(attendanceRecords.map((r: any) => String(r.member?._id))).size;

    // ── Payments settled today ────────────────────────────────────────────────
    const paidOffToday = settledPayments.filter((p: any) => p.paidAmount > 0);

    res.status(200).json({
      success: true,
      data: {
        date: dateStr,
        shiftType: activeShift,
        financial: { totalIncome, totalExpense, netProfit, singleVisitsRevenue },
        incomeByCategory,
        expenseByCategory,
        transactions,
        subscriptions: {
          count: subscriptions.length,
          list: subscriptions,
        },
        singleVisits: {
          count: singleVisits.length,
          revenue: singleVisitsRevenue,
          list: singleVisits,
        },
        attendance: {
          totalVisits: attendanceRecords.length,
          uniqueVisitors,
          list: attendanceRecords,
        },
        newMembers: {
          count: newMembers.length,
          list: newMembers,
        },
        settledPayments: {
          count: paidOffToday.length,
          list: paidOffToday,
        },
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
