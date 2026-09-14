import crypto from 'crypto';
import mongoose from 'mongoose';

// Secret key derivation (fallback to fixed secret if env var not set)
const SECRET_SEED = process.env.PHONE_ENCRYPTION_KEY || process.env.JWT_SECRET || 'gym_system_ultra_secure_phone_encryption_key_2026';
const KEY = crypto.createHash('sha256').update(SECRET_SEED).digest(); // 32 bytes
const IV = crypto.createHash('md5').update(SECRET_SEED).digest(); // 16 bytes deterministic IV

const PREFIX = 'enc:';

/**
 * Encrypts a phone number using AES-256-CBC deterministically.
 * If already encrypted or empty, returns as is.
 */
export function encryptPhone(phone?: string | null): string {
  if (!phone || typeof phone !== 'string') return phone as any;
  const trimmed = phone.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith(PREFIX)) return trimmed; // already encrypted

  try {
    const cipher = crypto.createCipheriv('aes-256-cbc', KEY, IV);
    let encrypted = cipher.update(trimmed, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${PREFIX}${encrypted}`;
  } catch (err) {
    console.error('[crypto] Error encrypting phone:', err);
    return trimmed;
  }
}

/**
 * Decrypts an encrypted phone number.
 * If not encrypted (legacy plain text) or empty, returns original value gracefully.
 */
export function decryptPhone(cipherText?: string | null): string {
  if (!cipherText || typeof cipherText !== 'string') return cipherText as any;
  const trimmed = cipherText.trim();
  if (!trimmed) return '';
  if (!trimmed.startsWith(PREFIX)) return trimmed; // plain text fallback

  try {
    const hex = trimmed.slice(PREFIX.length);
    const decipher = crypto.createDecipheriv('aes-256-cbc', KEY, IV);
    let decrypted = decipher.update(hex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[crypto] Error decrypting phone:', err);
    return trimmed;
  }
}

/**
 * One-time background migration to encrypt any existing plain-text phone numbers in MongoDB.
 */
export async function migrateExistingPhoneEncryption(): Promise<void> {
  try {
    const db = mongoose.connection.db;
    if (!db) return;

    // Direct collection access to query raw database values
    const membersCollection = db.collection('members');
    const plainMembers = await membersCollection.find({
      phone: { $exists: true, $ne: '', $not: /^enc:/ },
    }).toArray();

    if (plainMembers.length > 0) {
      console.log(`🔒 [Encryption Migration] Found ${plainMembers.length} members with plain-text phone numbers. Encrypting...`);
      for (const m of plainMembers) {
        if (m.phone && typeof m.phone === 'string' && !m.phone.startsWith(PREFIX)) {
          const enc = encryptPhone(m.phone);
          await membersCollection.updateOne({ _id: m._id }, { $set: { phone: enc } });
        }
      }
      console.log(`✅ [Encryption Migration] Successfully encrypted ${plainMembers.length} member phone numbers.`);
    }

    const singleVisitsCollection = db.collection('singlevisits');
    const plainVisits = await singleVisitsCollection.find({
      phone: { $exists: true, $ne: '', $not: /^enc:/ },
    }).toArray();

    if (plainVisits.length > 0) {
      console.log(`🔒 [Encryption Migration] Found ${plainVisits.length} single visits with plain-text phone numbers. Encrypting...`);
      for (const v of plainVisits) {
        if (v.phone && typeof v.phone === 'string' && !v.phone.startsWith(PREFIX)) {
          const enc = encryptPhone(v.phone);
          await singleVisitsCollection.updateOne({ _id: v._id }, { $set: { phone: enc } });
        }
      }
      console.log(`✅ [Encryption Migration] Successfully encrypted ${plainVisits.length} single visit phone numbers.`);
    }
  } catch (err) {
    console.error('[Encryption Migration] Error running phone encryption migration:', err);
  }
}

