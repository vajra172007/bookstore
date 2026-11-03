// models/Book.js - shape of a book document
const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  author: { type: String, required: true, trim: true },
  isbn: { type: String, required: true, unique: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  category: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  image: { type: String, default: '' },   // image URL
  stock: { type: Number, required: true, min: 0, default: 0 },
});

module.exports = mongoose.model('Book', bookSchema);