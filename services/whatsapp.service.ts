/**
 * WhatsApp Service
 * ----------------
 * Designed to work with:
 * 1. Local WhatsApp Web (whatsapp-web.js) - FREE, uses Linked Devices (Recommended)
 * 2. Meta WhatsApp Business API
 * 3. Twilio API for WhatsApp
 * 4. Mock Mode (dev / logs to console)
 *
 * Set WHATSAPP_PROVIDER in .env to 'local' | 'meta' | 'twilio' | 'mock'
 */

import axios from 'axios';
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

const PROVIDER   = process.env.WHATSAPP_PROVIDER || 'mock';
const WA_TOKEN   = process.env.WHATSAPP_TOKEN || '';
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const TWILIO_SID  = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = process.env.TWILIO_WHATSAPP_FROM || '';

// ─── Local Auth / Client Instance ───────────────────────────────────────────

let client: Client | null = null;
let isReady = false;
let isInitializing = false; // Singleton guard to prevent double-init

export function initWhatsAppClient(retryCount = 0) {
  if (PROVIDER !== 'local') {
    console.log('[WhatsApp] Local client skipped (provider is not set to "local")');
    return;
  }

  // Prevent multiple simultaneous initializations
  if (isInitializing) {
    console.log('[WhatsApp] Already initializing, skipping duplicate call.');
    return;
  }

  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 8000;

  isInitializing = true;
  isReady = false;
  console.log('[WhatsApp] Initializing local client using whatsapp-web.js...');

  // Destroy old client cleanly before creating a new one
  if (client) {
    try { client.destroy(); } catch (_) { /* ignore */ }
    client = null;
  }

  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
      headless: true,
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--js-flags=--max-old-space-size=512',
        '--renderer-process-limit=2',
        '--disable-extensions',
        '--disable-software-rasterizer',
        '--mute-audio',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
      ]
    }
  });

  client.on('qr', (qr) => {
    console.log('\n======================================================================');
    console.log('[WhatsApp] Scan this QR code with your phone (WhatsApp → Linked Devices):');
    qrcode.generate(qr, { small: true });
    console.log('======================================================================\n');
  });

  client.on('ready', () => {
    console.log('[WhatsApp] ✅ Client authenticated and ready to send messages!');
    isReady = true;
    isInitializing = false;
  });

  client.on('auth_failure', (msg) => {
    console.error('[WhatsApp] ❌ Authentication failure:', msg);
    isReady = false;
    isInitializing = false;
  });

  client.on('disconnected', (reason) => {
    console.log('[WhatsApp] ⚠️ Disconnected:', reason);
    isReady = false;
    isInitializing = false;
    console.log('[WhatsApp] Attempting reconnect in 15 seconds...');
    setTimeout(() => initWhatsAppClient(0), 15000);
  });

  client.initialize().catch((err) => {
    isInitializing = false;
    console.error(`[WhatsApp] ❌ Initialization error (attempt ${retryCount + 1}/${MAX_RETRIES}):`, err.message);
    if (retryCount < MAX_RETRIES - 1) {
      console.log(`[WhatsApp] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
      setTimeout(() => initWhatsAppClient(retryCount + 1), RETRY_DELAY_MS);
    } else {
      console.error('[WhatsApp] ❌ Max retries reached. WhatsApp sending disabled.');
    }
  });
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Normalise to international format (Egypt +20 prefix) */
const normalisePhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) return '20' + digits.slice(1);
  if (digits.startsWith('20')) return digits;
  return '20' + digits;
};

// ─── low-level send functions ─────────────────────────────────────────────────

async function sendViaLocal(to: string, message: string): Promise<void> {
  if (!client || !isReady) {
    throw new Error('WhatsApp local client is not ready. Please ensure the QR code has been scanned.');
  }

  const chatId = `${to}@c.us`;

  // Retry up to 3 times with a 2-second gap (handles transient getChat errors)
  let lastErr: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await client.sendMessage(chatId, message);
      return; // success
    } catch (err: any) {
      lastErr = err;
      console.warn(`[WhatsApp] sendMessage attempt ${attempt} failed: ${err.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

async function sendViaMeta(to: string, message: string): Promise<void> {
  await axios.post(
    `https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
    },
    { headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' } }
  );
}

async function sendViaTwilio(to: string, message: string): Promise<void> {
  const params = new URLSearchParams({
    From: `whatsapp:+${TWILIO_FROM}`,
    To:   `whatsapp:+${to}`,
    Body: message,
  });
  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    params.toString(),
    {
      auth: { username: TWILIO_SID, password: TWILIO_AUTH },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );
}

async function sendMock(to: string, message: string): Promise<void> {
  console.log(`\n📱 [WhatsApp MOCK] → +${to}`);
  console.log(`💬 Message: ${message}\n`);
}

// ─── main send function ───────────────────────────────────────────────────────

export async function sendWhatsApp(rawPhone: string, message: string): Promise<void> {
  const phone = normalisePhone(rawPhone);
  switch (PROVIDER) {
    case 'local':   return sendViaLocal(phone, message);
    case 'meta':    return sendViaMeta(phone, message);
    case 'twilio':  return sendViaTwilio(phone, message);
    default:        return sendMock(phone, message);
  }
}

// ─── message templates ────────────────────────────────────────────────────────

export const templates = {
  expiry1Day: (name: string, expiryDate: string) =>
    `🔔 أهلاً ${name}،\n\nتذكير: اشتراكك في الجيم هينتهي بكره ${expiryDate}.\n\nجدد اشتراكك في الاستقبال وإحنا في خدمتك ❤️`,

  expiry3Days: (name: string, expiryDate: string) =>
    `🔔 أهلاً ${name}،\n\nاشتراكك في الجيم هينتهي بعد 3 أيام في ${expiryDate}.\n\nجدد اشتراكك قبل ما يخلص ❤️`,

  expiry7Days: (name: string, expiryDate: string) =>
    `🔔 أهلاً ${name}،\n\nاشتراكك في الجيم هينتهي بعد أسبوع في ${expiryDate}.\n\nفكر في التجديد عشان متنقطعش 💪`,

  expired: (name: string) =>
    `⚠️ أهلاً ${name}،\n\nاشتراكك في الجيم انتهى. بادر بالتجديد عشان ترجع تتمرن معانا. منتظرينك ❤️`,

  paymentSuccess: (name: string, planName: string, endDate: string, qrLink: string) =>
    `✅ أهلاً ${name}،\n\nتم تسجيل اشتراكك في "${planName}" بنجاح.\n\nالاشتراك صالح حتى: ${endDate}\n\nرابط كود الـ QR الخاص بك للدخول للجيم:\n${qrLink}\n\nيلا تمرن 💪`,

  newMembership: (name: string) =>
    `🎉 أهلاً وسهلاً ${name} في عيلتنا!\n\nسعداء بانضمامك لجيمنا. لو محتاج أي مساعدة، إحنا دايماً هنا. يلا نبدأ 💪`,

  birthday: (name: string) =>
    `🎂 كل سنة وانت طيب ${name}!\n\nفريق الجيم بيتمنالك عيد ميلاد سعيد وصحة ورشاقة دايماً 🎉`,

  subscriptionFrozen: (name: string, freezeEndDate: string) =>
    `❄️ أهلاً ${name}،\n\nتم تجميد (Freeze) اشتراكك في الجيم بناءً على طلبك لمدة أسبوع.\n\nتاريخ انتهاء التجميد التلقائي: ${freezeEndDate}\n\nننتظر عودتك قريباً 💪`,

  subscriptionUnfrozen: (name: string, newEndDate: string) =>
    `🔥 أهلاً ${name}،\n\nتم إلغاء تجميد اشتراكك في الجيم بنجاح.\n\nاشتراكك الآن نشط وصالح حتى: ${newEndDate}\n\nيلا نرجع للتمرين! 🏋️`,
};
