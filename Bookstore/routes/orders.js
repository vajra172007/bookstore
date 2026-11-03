// routes/orders.js - create an order after the (fake) payment
const express = require('express');
const mongoose = require('mongoose');
const Book = require('../models/Book');
const User = require('../models/User');
const Order = require('../models/Order');

const router = express.Router();

// POST /api/orders
// Body: {
//   userId: "...",
//   items: [{ bookId: "...", quantity: 2 }],
//   shippingAddress: { fullName, address, city, pincode, phone }
// }
router.post('/', async (req, res) => {
  try {
    const { userId, items, shippingAddress } = req.body;

    // 1. Validate the request
    if (!userId || !mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ message: 'Please login before placing an order' });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({ message: 'User not found. Please login again' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }
    const a = shippingAddress || {};
    if (!a.fullName || !a.address || !a.city || !a.pincode || !a.phone) {
      return res.status(400).json({ message: 'Complete shipping address is required' });
    }

    // 2. Check every book and its stock. The price comes from the database,
    //    NOT from the browser, so users cannot change prices.
    const orderItems = [];
    const booksToUpdate = [];
    let total = 0;

    for (const item of items) {
      const quantity = Number(item.quantity);

      if (!mongoose.isValidObjectId(item.bookId) || !Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ message: 'Invalid item in cart' });
      }

      const book = await Book.findById(item.bookId);
      if (!book) {
        return res.status(400).json({ message: 'A book in your cart no longer exists' });
      }
      if (quantity > book.stock) {
        return res.status(400).json({
          message: `Only ${book.stock} copies of "${book.title}" are in stock`,
        });
      }

      orderItems.push({ book: book._id, title: book.title, price: book.price, quantity });
      booksToUpdate.push({ book, quantity });
      total += book.price * quantity;
    }

    // 3. Reduce the stock of each book
    for (const entry of booksToUpdate) {
      entry.book.stock -= entry.quantity;
      await entry.book.save();
    }

    // 4. Create the order (payment is FAKE, so it is always marked "Paid")
    const order = await Order.create({
      user: user._id,
      items: orderItems,
      total: Math.round(total * 100) / 100,
      shippingAddress: {
        fullName: a.fullName,
        address: a.address,
        city: a.city,
        pincode: a.pincode,
        phone: a.phone,
      },
      paymentStatus: 'Paid',
    });

    res.status(201).json({
      message: 'Order placed successfully',
      orderId: order._id,
      total: order.total,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;