// routes/auth.js - register and login
const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const router = express.Router();

// POST /api/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Basic validation
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Prevent duplicate email
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(400).json({ message: 'Email is already registered' });
    }

    // Hash the password with bcrypt (never store plain passwords)
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({ name, email, password: hashedPassword });

    res.status(201).json({
      message: 'Registration successful',
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    // 11000 = MongoDB duplicate key error (safety net for the unique email)
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Email is already registered' });
    }
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Compare the typed password with the stored hash
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Simple authentication: return the user's info.
    // The frontend will keep it in localStorage.
    res.json({
      message: 'Login successful',
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;