// models/User.js - shape of a user document
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: {
    type: String,
    required: true,
    unique: true,       // prevents duplicate emails
    lowercase: true,    // always store emails in lowercase
    trim: true,
  },
  password: { type: String, required: true }, // stored as a bcrypt hash
});

module.exports = mongoose.model('User', userSchema);