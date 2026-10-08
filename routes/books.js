// routes/books.js - list/search books, book details, add a book
const express = require('express');
const mongoose = require('mongoose');
const Book = require('../models/Book');

const router = express.Router();

// Helper: make user text safe to use inside a regular expression
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/books?search=clean&category=Technology
// Returns all books, optionally filtered by title/author and category
router.get('/', async (req, res) => {
  try {
    const { search, category } = req.query;
    const filter = {};

    if (search && search.trim()) {
      const regex = new RegExp(escapeRegex(search.trim()), 'i'); // case-insensitive
      filter.$or = [{ title: regex }, { author: regex }];
    }
    if (category && category.trim() && category !== 'All') {
      filter.category = category.trim();
    }

    const books = await Book.find(filter).sort({ title: 1 });
    res.json(books);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/books/categories/list
// Returns the list of distinct categories (used by the category filter).
// NOTE: this must be defined BEFORE "/:id", otherwise "categories" is treated as an id.
router.get('/categories/list', async (req, res) => {
  try {
    const categories = await Book.distinct('category');
    res.json(categories.sort());
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/books/:id - details of one book
router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid book id' });
    }
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ message: 'Book not found' });
    }
    res.json(book);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/books - admin adds a new book
router.post('/', async (req, res) => {
  try {
    const { title, author, isbn, price, category, description, image, stock } = req.body;

    // Basic validation
    if (!title || !author || !isbn || !category || price === undefined || stock === undefined) {
      return res.status(400).json({
        message: 'Title, author, ISBN, price, category and stock are required',
      });
    }
    if (Number(price) < 0 || Number(stock) < 0) {
      return res.status(400).json({ message: 'Price and stock cannot be negative' });
    }

    // Prevent duplicate ISBN
    const existing = await Book.findOne({ isbn: String(isbn).trim() });
    if (existing) {
      return res.status(400).json({ message: 'A book with this ISBN already exists' });
    }

    const book = await Book.create({
      title,
      author,
      isbn,
      price: Number(price),
      category,
      description: description || '',
      image: image || '',
      stock: Number(stock),
    });

    res.status(201).json({ message: 'Book added successfully', book });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;