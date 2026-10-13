// createAdmin.js - makes (or promotes) an admin account
// Run: node createAdmin.js admin@bookstore.com "Admin@123" "Store Admin"
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

async function main() {
  const [email, password, name = 'Admin'] = process.argv.slice(2);
  if (!email || !password) {
    console.log('Usage: node createAdmin.js <email> <password> [name]');
    return;
  }
  await mongoose.connect(process.env.MONGO_URI);
  const hash = await bcrypt.hash(password, 10);
  await User.findOneAndUpdate(
    { email: email.toLowerCase().trim() },
    { name, email, password: hash, role: 'admin' },
    { upsert: true, new: true }
  );
  console.log(`Admin ready: ${email}`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
