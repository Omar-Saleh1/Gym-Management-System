import mongoose from 'mongoose';
import { migrateExistingPhoneEncryption } from '../utils/crypto';

const connectDB = async (): Promise<void> => {
  try {
    const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/gym_system';
    await mongoose.connect(uri);
    console.log('✅ MongoDB Connected:', uri);
    migrateExistingPhoneEncryption().catch(e => console.error('[Migration] Failed:', e));
  } catch (err: any) {
    console.error('❌ MongoDB Connection Error:', err.message);
    process.exit(1);
  }
};

export default connectDB;
