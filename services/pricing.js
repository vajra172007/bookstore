// services/pricing.js - prices a cart using DATABASE prices and checks stock.
// The browser's prices and totals are never trusted.
const mongoose = require('mongoose');
const Book = require('../models/Book');
const { round2 } = require('./coupon');

class CartError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CartError';
    this.status = 400;
  }
}

// items: [{ bookId, quantity }] -> { lines: [{ book, quantity }], subtotal }
async function priceCart(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new CartError('Cart is empty');
  }

  const lines = [];
  let subtotal = 0;

  for (const item of items) {
    const quantity = Number(item.quantity);
    if (!mongoose.isValidObjectId(item.bookId) || !Number.isInteger(quantity) || quantity < 1) {
      throw new CartError('Invalid item in cart');
    }

    const book = await Book.findById(item.bookId);
    if (!book) {
      throw new CartError('A book in your cart no longer exists');
    }
    if (quantity > book.stock) {
      throw new CartError(`Only ${book.stock} copies of "${book.title}" are in stock`);
    }

    lines.push({ book, quantity });
    subtotal += book.price * quantity;
  }

  return { lines, subtotal: round2(subtotal) };
}

module.exports = { priceCart, CartError };
