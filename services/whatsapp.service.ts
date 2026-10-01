import axios from 'axios';
import fs from 'fs';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode';
import { Boom } from '@hapi/boom';

import { useMongoDBAuthState, AuthModel } from './mongoAuthState';

const PROVIDER = process.env.WHATSAPP_PROVIDER || 'local'; // default to local now

// Baileys config
let waSocket: any = null;
let currentQrDataUrl: string | null = null;
let isConnected = false;
let isInitializing = false;
let bootstrapRequested = false;

const logger = pino({ level: 'silent' });

// Status exports
export const getWhatsAppStatus = () => {
  return {
    status: isConnected ? 'connected' : (currentQrDataUrl ? 'qr_ready' : 'disconnected'),
    provider: 'baileys_local',
    connected: isConnected,
  };
};

export const getLatestQrDataUrl = () => {
  return currentQrDataUrl;
};

// Initialize client
export async function initWhatsAppClient() {
  if (PROVIDER !== 'local') return;
  if (isInitializing || isConnected) return;
  
  isInitializing = true;
  bootstrapRequested = true;
  console.log('[WhatsApp] Starting Baileys (Lightweight)...');

  try {
    const { state, saveCreds } = await useMongoDBAuthState('gym-system');

    waSocket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger,
      browser: ['Gym System', 'Chrome', '1.0.0'],
    });

    waSocket.ev.on('creds.update', saveCreds);

    waSocket.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('[WhatsApp] QR Code received. Awaiting scan...');
        currentQrDataUrl = await qrcode.toDataURL(qr);
      }

      if (connection === 'close') {
        isConnected = false;
        currentQrDataUrl = null;
        isInitializing = false;
        
        const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('[WhatsApp] Connection closed. Reconnect:', shouldReconnect);
        
        if (shouldReconnect) {
          setTimeout(initWhatsAppClient, 5000);
        } else {
          console.log('[WhatsApp] Logged out. Wiping MongoDB auth state to restart.');
          await AuthModel.deleteMany({ sessionId: 'gym-system' }).catch(console.error);
          setTimeout(initWhatsAppClient, 5000);
        }
      }

      if (connection === 'open') {
        isConnected = true;
        currentQrDataUrl = null;
        isInitializing = false;
        console.log('[WhatsApp] Connection opened successfully!');
      }
    });

  } catch (err) {
    console.error('[WhatsApp] Initialization error:', err);
    isInitializing = false;
  }
}

export async function restartWhatsApp() {
  console.log('[WhatsApp] Restarting session...');
  isConnected = false;
  currentQrDataUrl = null;
  isInitializing = false;
  if (waSocket) {
    try {
      waSocket.ev.removeAllListeners('connection.update');
      waSocket.ev.removeAllListeners('creds.update');
      waSocket.end(new Error('Manual Restart'));
    } catch (e) {
      // ignore
    }
    waSocket = null;
  }
  await AuthModel.deleteMany({ sessionId: 'gym-system' }).catch(console.error);
  return initWhatsAppClient();
}

import { decryptPhone } from '../utils/crypto';

// Helpers
// Convert Arabic-Indic numerals (٠-٩) to standard ASCII digits (0-9)
const convertArabicDigits = (str: string): string => {
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return str.replace(/[٠-٩]/g, (w) => String(arabicDigits.indexOf(w)));
};

export const normalisePhone = (rawPhone: string): string => {
  if (!rawPhone || typeof rawPhone !== 'string') return '';
  
  let phone = rawPhone;
  // If encrypted with enc: prefix, attempt decryption
  if (phone.startsWith('enc:')) {
    const decrypted = decryptPhone(phone);
    if (decrypted && decrypted !== phone && !decrypted.startsWith('enc:')) {
      phone = decrypted;
    } else {
      // Fallback: strip prefix if decryption produced same string or error
      phone = phone.replace(/^enc:/, '');
    }
  }

  // Convert Arabic digits
  phone = convertArabicDigits(phone);
  // Extract digits only
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('0')) return '20' + digits.slice(1);
  if (digits.startsWith('20')) return digits;
  return '20' + digits;
};

// Main send function with auto-wait if reconnecting
export async function sendWhatsApp(rawPhone: string, message: string): Promise<void> {
  const phone = normalisePhone(rawPhone);
  
  if (!phone || phone.length < 11) {
    console.error(`[WhatsApp] Invalid phone number after normalization: "${rawPhone}" -> "${phone}"`);
    throw new Error(`رقم الهاتف غير صالح: ${rawPhone}`);
  }

  if (PROVIDER !== 'local') {
    console.log(`\n[WhatsApp MOCK] -> +${phone}\nMessage: ${message}\n`);
    return;
  }

  // If initializing, wait up to 4 seconds for connection
  if (!isConnected && isInitializing) {
    console.log('[WhatsApp] Client is reconnecting, waiting up to 4 seconds...');
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (isConnected && waSocket) break;
    }
  }

  if (!isConnected || !waSocket) {
    console.warn('[WhatsApp] Cannot send message, client not connected.');
    throw new Error('خدمة الواتساب غير متصلة حالياً على السيرفر');
  }

  try {
    const formattedPhone = phone + '@s.whatsapp.net';
    await waSocket.sendMessage(formattedPhone, { text: message });
    console.log(`[WhatsApp] ✅ Message sent to ${formattedPhone}`);
  } catch (err: any) {
    console.error('[WhatsApp] ❌ Send error:', err);
    throw err;
  }
}

// Message templates
export const templates = {
  expiry1Day: (name: string, expiryDate: string) =>
    `أهلاً ${name}،\n\nتذكير من VACUUM GYM: اشتراكك سينتهي غداً ${expiryDate}.\n\nنرجو تجديده في أقرب وقت لتجنب الإيقاف. في انتظارك! 🏋️‍♂️`,

  expiry3Days: (name: string, expiryDate: string) =>
    `أهلاً ${name}،\n\nتذكير من VACUUM GYM: اشتراكك سينتهي بعد 3 أيام في ${expiryDate}.\n\nنرجو تجديده قريباً، ولا تنسَ تمرينك! 🏋️‍♂️`,

  expiry7Days: (name: string, expiryDate: string) =>
    `أهلاً ${name}،\n\nاشتراكك في VACUUM GYM سينتهي بعد أسبوع في ${expiryDate}.\n\nنتمنى لك استمراراً مليئاً بالنشاط! 🔥`,

  expired: (name: string) =>
    `عفواً ${name}،\n\nاشتراكك في VACUUM GYM انتهى. نرجو تجديد الاشتراك لمتابعة التمارين. في انتظارك! 🏋️‍♂️`,

  paymentSuccess: (name: string, planName: string, endDate: string, qrLink: string) =>
    `مرحباً ${name}،\n\nتم تجديد اشتراكك في VACUUM GYM ("${planName}") بنجاح! 🏋️‍♂️\n\nتاريخ الانتهاء: ${endDate}\n\nيرجى فتح رابط الـ QR الخاص بك ومسحه عند الحضور:\n${qrLink}\n\nنتمنى لك تمريناً رائعاً معنا! 💪`,

  newSubscription: (name: string, planName: string, endDate: string, qrLink: string) =>
    `مرحباً ${name}،\n\nأهلاً بك في عائلة VACUUM GYM! تم تفعيل اشتراكك في "${planName}" بنجاح! 🏋️‍♂️🔥\n\nتاريخ الانتهاء: ${endDate}\n\nيرجى فتح رابط الـ QR الخاص بك ومسحه عند الحضور:\n${qrLink}\n\nنتمنى لك تمريناً رائعاً وتحقيق أهدافك معنا! 💪`,

  newMembership: (name: string) =>
    `أهلاً بك يا ${name} في VACUUM GYM!\n\nيسعدنا انضمامك إلينا. نتمنى لك تجربة رياضية ممتازة وتحقيق أهدافك معنا. أهلاً بك في عائلتنا! 🏋️‍♂️💪`,

  qrLinkOnly: (name: string, qrLink: string) =>
    `مرحباً ${name}،\n\nإليك رابط كود الـ QR الخاص بك في VACUUM GYM:\n${qrLink}\n\nيرجى فتح الرابط ومسحه عند الحضور. نتمنى لك تمريناً رائعاً! 💪`,

  birthday: (name: string) =>
    `كل عام وأنت بخير يا ${name}!\n\nنتمنى لك سنة جديدة سعيدة ومليئة بالصحة والنجاح من عائلة VACUUM GYM. استمتع بيومك! 🎂🎉`,

  subscriptionFrozen: (name: string, freezeEndDate: string) =>
    `مرحباً ${name}،\n\nتم تجميد (Freeze) اشتراكك في VACUUM GYM بناءً على طلبك بنجاح.\n\nتاريخ انتهاء التجميد: ${freezeEndDate}\n\nننتظر عودتك بكل حماس! ❄️`,

  subscriptionUnfrozen: (name: string, newEndDate: string) =>
    `أهلاً ${name}،\n\nتم إلغاء تجميد اشتراكك في VACUUM GYM بنجاح.\n\nتاريخ الانتهاء الجديد هو: ${newEndDate}\n\nيلا بينا نرجع للتمرين بقوة! 🏋️‍♂️💪`,

  checkInSuccess: (name: string, time: string) =>
    `أهلاً يا ${name}،\n\nتم تسجيل حضورك اليوم في VACUUM GYM بنجاح في تمام الساعة ${time}.`,
};

