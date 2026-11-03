// tests/books.test.js
// Unit tests for routes/books.js (list/search, categories, details, add book).
// MongoDB is NOT used. The Book model is replaced with a mock.
// { virtual: true } lets the mock work even if the models folder is not present.

const request = require('supertest');
const express = require('express');

jest.mock(
  '../models/Book',
  () => ({
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    distinct: jest.fn(),
    create: jest.fn(),
  }),
  { virtual: true }
);

const Book = require('../models/Book');
const booksRouter = require('../routes/books');

const app = express();
app.use(express.json());
app.use('/api/books', booksRouter);

const VALID_ID = '64b7f0f2f2f2f2f2f2f2f2f1';

const validBook = {
  title: 'Clean Code',
  author: 'Robert C. Martin',
  isbn: '9780132350884',
  price: 899,
  category: 'Technology',
  stock: 15,
};

// Book.find(...) is followed by .sort(...) in the route
function mockFind(result) {
  const sort = jest.fn().mockResolvedValue(result);
  Book.find.mockReturnValue({ sort });
  return sort;
}

let consoleSpy;
beforeEach(() => {
  jest.resetAllMocks();
  consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => consoleSpy.mockRestore());

// =====================================================================
// GET /api/books
// =====================================================================
describe('GET /api/books', () => {
  test('returns all books with an empty filter, sorted by title', async () => {
    const sort = mockFind([{ title: 'A' }, { title: 'B' }]);

    const res = await request(app).get('/api/books');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(Book.find).toHaveBeenCalledWith({});
    expect(sort).toHaveBeenCalledWith({ title: 1 });
  });

  test('search matches title OR author, case-insensitively', async () => {
    mockFind([]);

    await request(app).get('/api/books?search=%20clean%20');   // padded with spaces

    const filter = Book.find.mock.calls[0][0];
    expect(filter.$or).toHaveLength(2);
    const regex = filter.$or[0].title;
    expect(regex.flags).toContain('i');
    expect(regex.test('Clean Code')).toBe(true);
    expect(filter.$or[1].author).toEqual(regex);
    expect(regex.source).toBe('clean');                        // trimmed
  });

  test('escapes regex special characters in the search text', async () => {
    mockFind([]);

    await request(app).get('/api/books').query({ search: 'C++ (2nd) [ed].*' });

    const regex = Book.find.mock.calls[0][0].$or[0].title;
    expect(regex.test('C++ (2nd) [ed].*')).toBe(true);         // literal match
    expect(regex.test('C 2nd ed')).toBe(false);                // not treated as a pattern
  });

  test('ignores a blank search', async () => {
    mockFind([]);

    await request(app).get('/api/books?search=%20%20');

    expect(Book.find).toHaveBeenCalledWith({});
  });

  test('filters by category', async () => {
    mockFind([]);

    await request(app).get('/api/books?category=Technology');

    expect(Book.find).toHaveBeenCalledWith({ category: 'Technology' });
  });

  test('category "All" does not filter', async () => {
    mockFind([]);

    await request(app).get('/api/books?category=All');

    expect(Book.find).toHaveBeenCalledWith({});
  });

  test('combines search and category', async () => {
    mockFind([]);

    await request(app).get('/api/books?search=code&category=Technology');

    const filter = Book.find.mock.calls[0][0];
    expect(filter.category).toBe('Technology');
    expect(filter.$or).toBeDefined();
  });

  test('returns 500 when the database fails', async () => {
    Book.find.mockImplementation(() => { throw new Error('DB down'); });

    const res = await request(app).get('/api/books');

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Server error');
  });
});

// =====================================================================
// GET /api/books/categories/list
// =====================================================================
describe('GET /api/books/categories/list', () => {
  test('returns the categories sorted alphabetically', async () => {
    Book.distinct.mockResolvedValue(['Technology', 'Fantasy', 'Business']);

    const res = await request(app).get('/api/books/categories/list');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(['Business', 'Fantasy', 'Technology']);
    expect(Book.distinct).toHaveBeenCalledWith('category');
  });

  test('is not mistaken for a book id (route order)', async () => {
    Book.distinct.mockResolvedValue([]);

    const res = await request(app).get('/api/books/categories/list');

    expect(res.status).toBe(200);
    expect(Book.findById).not.toHaveBeenCalled();
  });

  test('returns 500 when the database fails', async () => {
    Book.distinct.mockRejectedValue(new Error('DB down'));

    const res = await request(app).get('/api/books/categories/list');

    expect(res.status).toBe(500);
  });
});

// =====================================================================
// GET /api/books/:id
// =====================================================================
describe('GET /api/books/:id', () => {
  test('returns the book when it exists', async () => {
    Book.findById.mockResolvedValue({ _id: VALID_ID, title: 'Clean Code' });

    const res = await request(app).get(`/api/books/${VALID_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Clean Code');
  });

  test('rejects an invalid id with 400 (no database call)', async () => {
    const res = await request(app).get('/api/books/not-an-id');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid book id');
    expect(Book.findById).not.toHaveBeenCalled();
  });

  test('returns 404 when the book does not exist', async () => {
    Book.findById.mockResolvedValue(null);

    const res = await request(app).get(`/api/books/${VALID_ID}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Book not found');
  });

  test('returns 500 when the database fails', async () => {
    Book.findById.mockRejectedValue(new Error('DB down'));

    const res = await request(app).get(`/api/books/${VALID_ID}`);

    expect(res.status).toBe(500);
  });
});

// =====================================================================
// POST /api/books
// =====================================================================
describe('POST /api/books', () => {
  function post(body) {
    return request(app).post('/api/books').send(body);
  }

  test('adds a book successfully', async () => {
    Book.findOne.mockResolvedValue(null);
    Book.create.mockImplementation(async (d) => ({ _id: VALID_ID, ...d }));

    const res = await post(validBook);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Book added successfully');
    expect(res.body.book.title).toBe('Clean Code');
  });

  test('defaults description and image to empty strings', async () => {
    Book.findOne.mockResolvedValue(null);
    Book.create.mockImplementation(async (d) => d);

    await post(validBook);

    const saved = Book.create.mock.calls[0][0];
    expect(saved.description).toBe('');
    expect(saved.image).toBe('');
  });

  test('converts price and stock sent as strings into numbers', async () => {
    Book.findOne.mockResolvedValue(null);
    Book.create.mockImplementation(async (d) => d);

    await post({ ...validBook, price: '250.5', stock: '3' });

    const saved = Book.create.mock.calls[0][0];
    expect(saved.price).toBe(250.5);
    expect(saved.stock).toBe(3);
  });

  test('rejects the request when any required field is missing', async () => {
    for (const field of ['title', 'author', 'isbn', 'category', 'price', 'stock']) {
      const body = { ...validBook };
      delete body[field];

      const res = await post(body);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Title, author, ISBN, price, category and stock are required');
    }
    expect(Book.create).not.toHaveBeenCalled();
  });

  test('accepts price 0 and stock 0 (boundary values)', async () => {
    Book.findOne.mockResolvedValue(null);
    Book.create.mockImplementation(async (d) => d);

    const res = await post({ ...validBook, price: 0, stock: 0 });

    expect(res.status).toBe(201);
  });

  test('rejects a negative price', async () => {
    const res = await post({ ...validBook, price: -1 });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Price and stock cannot be negative');
    expect(Book.create).not.toHaveBeenCalled();
  });

  test('rejects a negative stock', async () => {
    const res = await post({ ...validBook, stock: -1 });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Price and stock cannot be negative');
  });

  test('rejects a duplicate ISBN', async () => {
    Book.findOne.mockResolvedValue({ _id: 'existing' });

    const res = await post(validBook);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('A book with this ISBN already exists');
    expect(Book.create).not.toHaveBeenCalled();
  });

  test('trims the ISBN when checking for duplicates', async () => {
    Book.findOne.mockResolvedValue({ _id: 'existing' });

    await post({ ...validBook, isbn: '  9780132350884  ' });

    expect(Book.findOne).toHaveBeenCalledWith({ isbn: '9780132350884' });
  });

  test('returns 500 when the database fails', async () => {
    Book.findOne.mockRejectedValue(new Error('DB down'));

    const res = await post(validBook);

    expect(res.status).toBe(500);
  });

  // KNOWN GAPS in routes/books.js. These document behaviour that SHOULD hold.
  // `test.failing` passes while the bug exists and starts failing once it is
  // fixed - at that point change it to a normal `test`.
  test.failing('rejects a non-numeric price (e.g. "abc") with 400', async () => {
    Book.findOne.mockResolvedValue(null);
    Book.create.mockImplementation(async (d) => d);

    const res = await post({ ...validBook, price: 'abc' });

    expect(res.status).toBe(400);   // currently NaN is saved / 500 from Mongoose
  });

  test.failing('does not save the ISBN with surrounding spaces', async () => {
    Book.findOne.mockResolvedValue(null);
    Book.create.mockImplementation(async (d) => d);

    await post({ ...validBook, isbn: '  9780132350884  ' });

    expect(Book.create.mock.calls[0][0].isbn).toBe('9780132350884');
  });
});
