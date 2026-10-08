// server.js - entry point of the app
require('dotenv').config();           // load PORT and MONGO_URI from .env
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const authRoutes = require('./routes/auth');
const bookRoutes = require('./routes/books');
const orderRoutes = require('./routes/orders');

const app = express();

// Middleware: lets us read JSON sent from the frontend
app.use(express.json());

// Serve the frontend files (HTML, CSS, JS) from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', authRoutes);          // POST /api/register, POST /api/login
app.use('/api/books', bookRoutes);    // GET/POST /api/books, GET /api/books/:id
app.use('/api/orders', orderRoutes);  // POST /api/orders

// Unknown API route -> JSON 404
app.use('/api', (req, res) => {
  res.status(404).json({ message: 'API route not found' });
});

const PORT = process.env.PORT || 3000;

// Connect to MongoDB first, then start the server
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });