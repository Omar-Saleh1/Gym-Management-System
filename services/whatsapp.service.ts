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
import fs from 'fs';
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode';

const PROVIDER    = process.env.WHATSAPP_PROVIDER || 'mock';
const WA_TOKEN    = process.env.WHATSAPP_TOKEN || '';
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const TWILIO_SID  = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = process.env.TWILIO_WHATSAPP_FROM || '';

// Ephemeral paths — survive container runtime but not redeploy (Render Free)
const AUTH_DATA_PATH  = process.env.WWEBJS_AUTH_PATH  || '/tmp/.wwebjs_auth';
const CACHE_DATA_PATH = process.env.WWEBJS_CACHE_PATH || '/tmp/.wwebjs_cache';

// Matches whatsapp-web.js 1.34.7 default (Constants.js)
const DEFAULT_WEB_VERSION = '2.3000.1017054665';
const WA_REMOTE_CACHE_URL =
  'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html';

// Optional override — full URL or version string (see .env.example)
const WA_WEB_VERSION = process.env.WA_WEB_VERSION;

const MAX_INIT_RETRIES     = 3;
const INIT_RETRY_DELAY_MS  = 8000;
const MAX_RECONNECT        = 3;
const RECONNECT_DELAY_MS   = 30000;

// ─── Singleton client state ───────────────────────────────────────────────────

let client: Client | null = null;
let isReady = false;
let isAuthenticated = false;
let isInitializing = false;
let bootstrapRequested = false;
let initPromise: Promise<void> | null = null;
let activeClientGen = 0;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

let latestQr: string | null = null;
let latestQrDataUrl: string | null = null;
let lastStatusMessage = 'not_started';

export interface WhatsAppStatus {
  ready: boolean;
  authenticated: boolean;
  statusMessage: string;
}

export interface WhatsAppStatusDetailed extends WhatsAppStatus {
  provider: string;
  initializing: boolean;
  hasQr: boolean;
  authDataPath: string;
  cacheDataPath: string;
}

export function getWhatsAppStatus(): WhatsAppStatus {
  return {
    ready: isReady,
    authenticated: isAuthenticated,
    statusMessage: lastStatusMessage,
  };
}

export function getWhatsAppStatusDetailed(): WhatsAppStatusDetailed {
  return {
    ...getWhatsAppStatus(),
    provider: PROVIDER,
    initializing: isInitializing,
    hasQr: !!latestQrDataUrl,
    authDataPath: AUTH_DATA_PATH,
    cacheDataPath: CACHE_DATA_PATH,
  };
}

export function getLatestQrDataUrl(): string | null {
  if (isReady || isAuthenticated) return null;
  return latestQrDataUrl;
}

// ─── Puppeteer config (Docker / Render) ──────────────────────────────────────

function getExecutablePath(): string | undefined {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.platform === 'win32') {
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }
  if (process.platform === 'linux') {
    return '/usr/bin/google-chrome-stable';
  }
  return undefined;
}

function buildWebVersionOptions(): Pick<ConstructorParameters<typeof Client>[0], 'webVersion' | 'webVersionCache'> {
  if (WA_WEB_VERSION?.startsWith('http')) {
    return {
      webVersionCache: {
        type: 'remote',
        remotePath: WA_WEB_VERSION,
        strict: false,
      },
    };
  }

  if (WA_WEB_VERSION) {
    return {
      webVersion: WA_WEB_VERSION,
      webVersionCache: {
        type: 'remote',
        remotePath: WA_REMOTE_CACHE_URL,
        strict: false,
      },
    };
  }

  return {
    webVersion: DEFAULT_WEB_VERSION,
    webVersionCache: {
      type: 'local',
      path: CACHE_DATA_PATH,
      strict: false,
    },
  };
}

function buildClientOptions() {
  const options: ConstructorParameters<typeof Client>[0] = {
    authStrategy: new LocalAuth({ dataPath: AUTH_DATA_PATH }),
    deviceName: 'Gym System',
    browserName: 'Chrome',
    ...buildWebVersionOptions(),
    puppeteer: {
      headless: true,
      executablePath: getExecutablePath(),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--no-first-run',
        '--no-zygote',
      ],
    },
  };

  return options;
}

// ─── Event handlers (attached once per client instance) ──────────────────────

function attachClientEvents(instance: Client, generation: number): void {
  instance.on('qr', async (qr) => {
    if (generation !== activeClientGen) return;
    if (isReady || isAuthenticated) {
      console.log('[WhatsApp] QR received (ignored — already authenticated/ready)');
      return;
    }

    latestQr = qr;
    lastStatusMessage = 'waiting_for_scan';
    console.log('[WhatsApp] QR received');

    try {
      latestQrDataUrl = await qrcode.toDataURL(qr, { width: 360, margin: 2, errorCorrectionLevel: 'M' });
    } catch (err: any) {
      console.error('[WhatsApp] Failed to build QR image:', err.message);
    }
  });

  instance.on('authenticated', () => {
    if (generation !== activeClientGen) return;
    isAuthenticated = true;
    latestQr = null;
    latestQrDataUrl = null;
    lastStatusMessage = 'authenticated';
    console.log('[WhatsApp] Authenticated');
  });

  instance.on('auth_failure', (msg) => {
    if (generation !== activeClientGen) return;
    console.error('[WhatsApp] Authentication failed:', msg);
    isReady = false;
    isAuthenticated = false;
    isInitializing = false;
    lastStatusMessage = 'auth_failure';
  });

  instance.on('loading_screen', (percent, message) => {
    if (generation !== activeClientGen) return;
    if (!isReady && isAuthenticated) lastStatusMessage = 'loading';
    console.log(`[WhatsApp] Loading ${percent}% — ${message}`);
  });

  instance.on('ready', () => {
    if (generation !== activeClientGen) return;
    isReady = true;
    isAuthenticated = true;
    isInitializing = false;
    reconnectAttempts = 0;
    latestQr = null;
    latestQrDataUrl = null;
    lastStatusMessage = 'ready';
    console.log('[WhatsApp] Ready');
  });

  instance.on('change_state', (state) => {
    if (generation !== activeClientGen) return;
    console.log('[WhatsApp] State changed:', state);
    if (isReady) return;
    if (state === 'CONNECTED' && isAuthenticated) {
      lastStatusMessage = 'authenticated';
    } else if (state === 'OPENING' && !isAuthenticated) {
      lastStatusMessage = 'waiting_for_scan';
    }
  });

  instance.on('disconnected', (reason) => {
    if (generation !== activeClientGen) return;
    console.log('[WhatsApp] Disconnected:', reason);
    isReady = false;
    isAuthenticated = false;
    isInitializing = false;
    lastStatusMessage = 'disconnected';

    const reasonStr = String(reason).toUpperCase();
    if (reasonStr.includes('LOGOUT')) {
      console.log('[WhatsApp] Logged out from phone — restart service to scan a new QR');
      void safeDestroyClient();
      return;
    }

    scheduleReconnect();
  });
}

// ─── Client lifecycle ─────────────────────────────────────────────────────────

function ensureRuntimeDirectories(): void {
  for (const dir of [AUTH_DATA_PATH, CACHE_DATA_PATH]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err: any) {
      console.error(`[WhatsApp] Failed to create directory ${dir}:`, err.message);
    }
  }
}

async function safeDestroyClient(): Promise<void> {
  if (!client) return;
  activeClientGen += 1;
  const toDestroy = client;
  client = null;
  try {
    await toDestroy.destroy();
  } catch (_) {
    /* ignore destroy errors */
  }
}

async function createClientInstance(retryCount: number): Promise<void> {
  if (isReady && client) {
    console.log('[WhatsApp] Client already ready, skipping initialize.');
    return;
  }

  if (initPromise) {
    console.log('[WhatsApp] Initialize already in progress, skipping.');
    return initPromise;
  }

  initPromise = runClientInitialize(retryCount).finally(() => {
    initPromise = null;
  });

  return initPromise;
}

async function runClientInitialize(retryCount: number): Promise<void> {
  isInitializing = true;
  lastStatusMessage = 'initializing';

  if (!isAuthenticated) {
    latestQr = null;
    latestQrDataUrl = null;
  }

  console.log('[WhatsApp] Initializing client...');
  console.log(`[WhatsApp] Auth path: ${AUTH_DATA_PATH}`);
  console.log(`[WhatsApp] Cache path: ${CACHE_DATA_PATH}`);

  ensureRuntimeDirectories();
  await safeDestroyClient();

  const generation = ++activeClientGen;
  const instance = new Client(buildClientOptions());
  client = instance;
  attachClientEvents(instance, generation);

  try {
    await instance.initialize();
    if (generation !== activeClientGen) return;
    if (!isReady && !isAuthenticated) {
      lastStatusMessage = latestQrDataUrl ? 'waiting_for_scan' : 'initializing';
    }
  } catch (err: any) {
    if (generation !== activeClientGen) return;
    isInitializing = false;
    lastStatusMessage = 'init_error';
    console.error(`[WhatsApp] Initialization error (attempt ${retryCount + 1}/${MAX_INIT_RETRIES}):`, err.message);

    await safeDestroyClient();

    if (retryCount < MAX_INIT_RETRIES - 1) {
      console.log(`[WhatsApp] Retrying initialize in ${INIT_RETRY_DELAY_MS / 1000}s...`);
      await new Promise((r) => setTimeout(r, INIT_RETRY_DELAY_MS));
      return createClientInstance(retryCount + 1);
    }

    console.error('[WhatsApp] Max init retries reached — WhatsApp disabled until service restart');
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;

  if (reconnectAttempts >= MAX_RECONNECT) {
    console.log('[WhatsApp] Max reconnect attempts reached — manual service restart required');
    lastStatusMessage = 'disconnected';
    return;
  }

  reconnectAttempts += 1;
  console.log(`[WhatsApp] Scheduling reconnect ${reconnectAttempts}/${MAX_RECONNECT} in ${RECONNECT_DELAY_MS / 1000}s...`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (isReady || initPromise) return;
    void createClientInstance(0);
  }, RECONNECT_DELAY_MS);
}

/**
 * Start WhatsApp client once per server process.
 * Safe to call from server startup — never creates duplicate clients.
 */
export function initWhatsAppClient(): void {
  if (PROVIDER !== 'local') {
    lastStatusMessage = 'skipped';
    console.log('[WhatsApp] Local client skipped (provider is not set to "local")');
    return;
  }

  if (bootstrapRequested) {
    console.log('[WhatsApp] Bootstrap already requested, skipping duplicate call.');
    return;
  }

  bootstrapRequested = true;
  void createClientInstance(0);
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
    throw new Error(
      'WhatsApp local client is not ready. Scan QR at /api/whatsapp/qr and wait for status "ready".'
    );
  }

  const chatId = `${to}@c.us`;

  let lastErr: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await client.sendMessage(chatId, message);
      return;
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
