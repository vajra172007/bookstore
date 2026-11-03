// tests/security.test.js - JWT and role checks
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret';

jest.mock('../models/Book', () => ({ findOne: jest.fn(), create: jest.fn() }));
const Book = require('../models/Book');
const booksRouter = require('../routes/books');

const app = express();
app.use(express.json());
app.use('/api/books', booksRouter);

const newBook = { title: 'T', author: 'A', isbn: '123', price: 10, category: 'X', stock: 5 };
const tokenFor = (role) => jwt.sign({ id: 'u1', role }, process.env.JWT_SECRET);

beforeEach(() => {
  jest.resetAllMocks();
  Book.findOne.mockResolvedValue(null);
  Book.create.mockResolvedValue({ _id: 'b1', ...newBook });
});

describe('POST /api/books - access control', () => {
  test('rejects a request with no token (401)', async () => {
    const res = await request(app).post('/api/books').send(newBook);
    expect(res.status).toBe(401);
    expect(Book.create).not.toHaveBeenCalled();
  });

  test('rejects an invalid token (401)', async () => {
    const res = await request(app).post('/api/books').set('Authorization', 'Bearer fake').send(newBook);
    expect(res.status).toBe(401);
  });

  test('rejects a customer (403)', async () => {
    const res = await request(app).post('/api/books').set('Authorization', `Bearer ${tokenFor('customer')}`).send(newBook);
    expect(res.status).toBe(403);
    expect(Book.create).not.toHaveBeenCalled();
  });

  test.each(['admin', 'staff'])('allows %s to add a book', async (role) => {
    const res = await request(app).post('/api/books').set('Authorization', `Bearer ${tokenFor(role)}`).send(newBook);
    expect(res.status).toBe(201);
  });
});
