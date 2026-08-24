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

// Helpers
const normalisePhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) return '20' + digits.slice(1);
  if (digits.startsWith('20')) return digits;
  return '20' + digits;
};

// Main send function
export async function sendWhatsApp(rawPhone: string, message: string): Promise<void> {
  const phone = normalisePhone(rawPhone);
  
  if (PROVIDER !== 'local') {
    console.log(`\n[WhatsApp MOCK] -> +${phone}\nMessage: ${message}\n`);
    return;
  }

  if (!isConnected || !waSocket) {
    console.warn('[WhatsApp] Cannot send message, client not connected.');
    return;
  }

  try {
    const formattedPhone = phone + '@s.whatsapp.net';
    await waSocket.sendMessage(formattedPhone, { text: message });
    console.log(`[WhatsApp] Message sent to ${formattedPhone}`);
  } catch (err: any) {
    console.error('[WhatsApp] Send error:', err);
    throw err;
  }
}

// Message templates
export const templates = {
  expiry1Day: (name: string, expiryDate: string) =>
    `أهلاً ${name}،\n\nتذكير: اشتراكك في الجيم سينتهي غداً ${expiryDate}.\n\nنرجو تجديده في أقرب وقت لتجنب الإيقاف.`,

  expiry3Days: (name: string, expiryDate: string) =>
    `أهلاً ${name}،\n\nاشتراكك في الجيم سينتهي بعد 3 أيام في ${expiryDate}.\n\nنرجو تجديده قريباً، ولا تنسَ تمرينك!`,

  expiry7Days: (name: string, expiryDate: string) =>
    `أهلاً ${name}،\n\nاشتراكك في الجيم سينتهي بعد أسبوع في ${expiryDate}.\n\nنتمنى لك استمراراً مليئاً بالنشاط!`,

  expired: (name: string) =>
    `عفواً ${name}،\n\nاشتراكك في الجيم انتهى. نرجو تجديد الاشتراك لمتابعة التمارين. في انتظارك!`,

  paymentSuccess: (name: string, planName: string, endDate: string, qrLink: string) =>
    `مرحباً ${name}،\n\nتم تجديد اشتراكك في "${planName}" بنجاح.\n\nتاريخ الانتهاء: ${endDate}\n\nيرجى فتح رابط الـ QR الخاص بك ومسحه عند الحضور:\n${qrLink}\n\nنتمنى لك تمريناً رائعاً!`,

  newMembership: (name: string) =>
    `أهلاً بك يا ${name} في الجيم!\n\nيسعدنا انضمامك إلينا. نتمنى لك تجربة رياضية ممتازة وتحقيق أهدافك معنا. أهلاً بك في عائلتنا!`,

  birthday: (name: string) =>
    `كل عام وأنت بخير يا ${name}!\n\nنتمنى لك سنة جديدة سعيدة ومليئة بالصحة والنجاح من عائلة الجيم. استمتع بيومك!`,

  subscriptionFrozen: (name: string, freezeEndDate: string) =>
    `مرحباً ${name}،\n\nتم تجميد (Freeze) اشتراكك في الجيم بناءً على طلبك بنجاح.\n\nتاريخ انتهاء التجميد: ${freezeEndDate}\n\nننتظر عودتك بكل حماس!`,

  subscriptionUnfrozen: (name: string, newEndDate: string) =>
    `أهلاً ${name}،\n\nتم إلغاء تجميد اشتراكك بنجاح.\n\nتاريخ الانتهاء الجديد هو: ${newEndDate}\n\nيلا بينا نرجع للتمرين بقوة! 🏋️‍♂️`,

  checkInSuccess: (name: string, time: string) =>
    `أهلاً يا ${name}،\n\nتم تسجيل حضورك في الجيم اليوم بنجاح في تمام الساعة ${time}.\n\nنتمنى لك تمرينة وحش! 🏋️‍♂️💪`,
};
