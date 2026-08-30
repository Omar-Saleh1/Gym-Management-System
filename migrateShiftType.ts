import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Member from './models/Member';
import Cashier from './models/Cashier';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodbi://localhost:27017/gym-system';

const runMigration = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected.');

    const memberResult = await Member.updateMany(
      { $or: [{ shiftType: { $exists: false } }, { shiftType: null }] },
      { $set: { shiftType: 'unassigned' } }
    );
    console.log(`Updated ${memberResult.modifiedCount} pre-existing members to shiftType: 'unassigned'.`);

    const girlsCount = await Member.countDocuments({ shiftType: 'GIRLS' });
    const boysCount = await Member.countDocuments({ shiftType: 'BOYS' });
    const unassignedCount = await Member.countDocuments({ shiftType: 'unassigned' });
    const cashiers = await Cashier.find().select('name username role shiftType');

    console.log('\n--- Migration Summary ---0');
    console.log(`C- GIRLS Members: ${girlsCount}`);
    console.log(`- BOYS Members: ${boysCount}`);
    console.log(`- Unassigned Members (Admin review needed): ${unassignedCount}`);
    console.log('\n--- Registered Cashiers ---');
    cashiers.forEach((c) => {
      console.log(`  • ${c.name} (${c.username}) - Role: ${c.role}, Shift: ${c.shiftType || 'All (Admin)'}`);
    });

    console.log('\nMigration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
};

runMigration();
