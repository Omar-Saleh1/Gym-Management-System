// شغل الملف ده مرة واحدة بس عشان تعمل أول حساب أدمن
// node seedAdmin.js
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Cashier = require('./models/Cashier');

(async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/gym_system');

  const exists = await Cashier.findOne({ username: 'admin' });
  if (exists) {
    console.log('⚠️ حساب الأدمن موجود بالفعل (username: admin)');
    process.exit(0);
  }

  const hashed = await bcrypt.hash('admin123', 10);
  await Cashier.create({ name: 'المدير العام', username: 'admin', password: hashed, role: 'admin' });
  console.log('✅ تم إنشاء حساب الأدمن بنجاح');
  console.log('Username: admin | Password: admin123');
  console.log('⚠️ غيّر الباسورد فورًا بعد أول تسجيل دخول');
  process.exit(0);
})();
