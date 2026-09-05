/**
 * Centralized Business Day Utility for Gym System (Africa/Cairo timezone).
 * 
 * Business Logic:
 * The gym operates late into the night (closing around 03:00 - 03:30 AM).
 * Therefore, any activity between 00:00:00 and 03:59:59 belongs to the PREVIOUS calendar day's night shift.
 * The new business day officially starts at 04:00:00 AM.
 */

export const getCairoNow = (): Date => {
  const str = new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' });
  return new Date(str);
};

/**
 * Returns the active business date as a YYYY-MM-DD string.
 * If current Cairo time is < 04:00 AM, returns yesterday's date.
 */
export const getBusinessDateString = (dateInput?: Date | string): string => {
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return dateInput;
  }

  let cairoDate: Date;
  if (!dateInput || dateInput === 'today') {
    cairoDate = getCairoNow();
    if (cairoDate.getHours() < 4) {
      cairoDate.setDate(cairoDate.getDate() - 1);
    }
  } else {
    const str = new Date(dateInput).toLocaleString('en-US', { timeZone: 'Africa/Cairo' });
    cairoDate = new Date(str);
    if (cairoDate.getHours() < 4) {
      cairoDate.setDate(cairoDate.getDate() - 1);
    }
  }

  const y = cairoDate.getFullYear();
  const m = String(cairoDate.getMonth() + 1).padStart(2, '0');
  const d = String(cairoDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Converts a Cairo local Date object to UTC Date stored in MongoDB.
 */
export const toCairoUtc = (localDate: Date): Date => {
  const temp = new Date(localDate.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  return new Date(localDate.getTime() - (temp.getTime() - localDate.getTime()));
};

/**
 * Computes exact UTC boundaries for a business day (YYYY-MM-DD).
 * Start: YYYY-MM-DD 04:00:00 Cairo time
 * End:   YYYY-MM-(DD+1) 03:59:59.999 Cairo time
 */
export const getBusinessDayBounds = (businessDateStr?: string) => {
  const targetDateStr = getBusinessDateString(businessDateStr);
  const [y, m, d] = targetDateStr.split('-').map(Number);

  const startCairo = new Date(y, m - 1, d, 4, 0, 0, 0);
  const endCairo = new Date(y, m - 1, d + 1, 3, 59, 59, 999);

  return {
    dateStr: targetDateStr,
    startUtc: toCairoUtc(startCairo),
    endUtc: toCairoUtc(endCairo),
  };
};

/**
 * Computes month bounds based on business day start at 04:00 AM on 1st of the month.
 */
export const getBusinessMonthBounds = (targetDate?: Date | string) => {
  const cairoNow = getCairoNow();
  let baseDate = cairoNow;
  if (targetDate) {
    baseDate = new Date(targetDate);
  } else if (cairoNow.getHours() < 4) {
    baseDate = new Date(cairoNow);
    baseDate.setDate(baseDate.getDate() - 1);
  }

  const y = baseDate.getFullYear();
  const m = baseDate.getMonth();

  const startCairo = new Date(y, m, 1, 4, 0, 0, 0);
  const nextMonthCairo = new Date(y, m + 1, 1, 3, 59, 59, 999);

  return {
    startUtc: toCairoUtc(startCairo),
    endUtc: toCairoUtc(nextMonthCairo),
  };
};
