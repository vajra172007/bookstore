// tests/input-validation.test.js - how the register, login and book routes handle odd input.
// Some cases are KNOWN DEFECTS (test.failing): the test describes the correct behaviour, and it
// passes only while the defect exists. When a defect is fixed, its test.failing starts failing;
// change it to a plain test at that point.
process.env.JWT_SECRET = 'test-secret';
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

jest.mock('../models/User', () => ({ findOne: jest.fn(), create: jest.fn() }));
jest.mock('../models/Book', () => ({ findOne: jest.fn(), create: jest.fn(), findOneAndUpdate: jest.fn() }));

const User = require('../models/User');
const Book = require('../models/Book');
const authRoutes = require('../routes/auth');
const bookRoutes = require('../routes/books');

const app = express();
app.use(express.json());
app.use('/api', authRoutes);
app.use('/api/books', bookRoutes);

const BOOK_ID = '64b7f0f2f2f2f2f2f2f2f2f1';
const adminAuth = () => ({ Authorization: `Bearer ${jwt.sign({ id: '64b7f0f2f2f2f2f2f2f2f2a1', role: 'admin' }, process.env.JWT_SECRET)}` });
const goodBook = { title: 'T', author: 'A', isbn: '123', price: 10, category: 'X', stock: 5 };

beforeEach(() => {
  jest.resetAllMocks();
  User.findOne.mockResolvedValue(null);
  User.create.mockImplementation(async (d) => ({ _id: 'u1', ...d }));
  Book.findOne.mockResolvedValue(null);
  Book.create.mockImplementation(async (d) => ({ _id: BOOK_ID, ...d }));
  Book.findOneAndUpdate.mockImplementation(async (filter, update) => ({ _id: filter._id, stock: update.$set.stock }));
});

// =====================================================================
// Register
// =====================================================================
describe('POST /api/register - input shape', () => {
  test.failing('KNOWN DEFECT: a name made only of spaces is rejected', async () => {
    // KNOWN DEFECT: only "!name" is checked, so "   " is accepted and saved.
    const res = await request(app).post('/api/register').send({ name: '   ', email: 'a@b.co', password: 'secret1' });
    expect(res.status).toBe(400);
  });

  test.failing('KNOWN DEFECT: a password sent as a number is refused with 400 (not a crash)', async () => {
    // KNOWN DEFECT: a numeric password reaches bcrypt and the route answers 500.
    const res = await request(app).post('/api/register').send({ name: 'V', email: 'a@b.co', password: 123456 });
    expect(res.status).toBe(400);
  });

  test.failing('KNOWN DEFECT: an email sent as a number is refused with 400 (not a crash)', async () => {
    // KNOWN DEFECT: email.toLowerCase() throws for a non-text email, so the route answers 500.
    const res = await request(app).post('/api/register').send({ name: 'V', email: 12345, password: 'secret1' });
    expect(res.status).toBe(400);
  });

  test('an email with surrounding spaces and capitals is saved in clean lower case', async () => {
    const res = await request(app).post('/api/register').send({ name: 'V', email: '  Vajra@Example.COM ', password: 'secret1' });
    expect(res.status).toBe(201);
    expect(User.create.mock.calls[0][0].email).toBe('vajra@example.com');
  });

  test('the stored password is a bcrypt hash that verifies against the original', async () => {
    await request(app).post('/api/register').send({ name: 'V', email: 'a@b.co', password: 'secret1' });
    const stored = User.create.mock.calls[0][0].password;
    expect(stored).not.toBe('secret1');
    expect(await bcrypt.compare('secret1', stored)).toBe(true);
  });

  test('a password of exactly 6 characters with spaces counts every character', async () => {
    const res = await request(app).post('/api/register').send({ name: 'V', email: 'a@b.co', password: '      ' });
    expect(res.status).toBe(201);
  });

  test('registering with the admin address gives the admin role even if the body asks for another role', async () => {
    const res = await request(app).post('/api/register').send({ name: 'V', email: 'vajra172007@gmail.com', password: 'secret1', role: 'customer' });
    expect(res.status).toBe(201);
    expect(User.create.mock.calls[0][0].role).toBe('admin');
  });

  test('a role sent in the body for an ordinary address is ignored (customer)', async () => {
    await request(app).post('/api/register').send({ name: 'V', email: 'a@b.co', password: 'secret1', role: 'admin' });
    expect(User.create.mock.calls[0][0].role).toBe('customer');
  });
});

// =====================================================================
// Login
// =====================================================================
describe('POST /api/login - input and token', () => {
  const storedUser = async (role = 'customer') => ({
    _id: '64b7f0f2f2f2f2f2f2f2f2a1', name: 'V', email: 'a@b.co', role,
    password: await bcrypt.hash('secret1', 4),
  });

  test('a token expires after 8 hours', async () => {
    User.findOne.mockResolvedValue(await storedUser());
    const res = await request(app).post('/api/login').send({ email: 'a@b.co', password: 'secret1' });
    const payload = jwt.decode(res.body.token);
    expect(payload.exp - payload.iat).toBe(8 * 60 * 60);
  });

  test('the token carries the user id and role, and never the password', async () => {
    User.findOne.mockResolvedValue(await storedUser('staff'));
    const res = await request(app).post('/api/login').send({ email: 'a@b.co', password: 'secret1' });
    const payload = jwt.decode(res.body.token);
    expect(payload).toMatchObject({ id: '64b7f0f2f2f2f2f2f2f2f2a1', role: 'staff' });
    expect(JSON.stringify(payload)).not.toContain('secret1');
  });

  test('an object sent in place of the email does not log anyone in (no query injection)', async () => {
    const res = await request(app).post('/api/login').send({ email: { $ne: null }, password: 'secret1' });
    expect(res.status).not.toBe(200);
    expect(res.body.token).toBeUndefined();
  });

  test.failing('KNOWN DEFECT: a password sent as a list is refused and nobody is logged in', async () => {
    // KNOWN DEFECT: a non-text password makes bcrypt throw, and the route answers 500, not 400/401.
    User.findOne.mockResolvedValue(await storedUser());
    const res = await request(app).post('/api/login').send({ email: 'a@b.co', password: ['secret1'] });
    expect(res.body.token).toBeUndefined();
    expect([400, 401]).toContain(res.status);
  });
});

// =====================================================================
// Books: adding a book with odd values
// =====================================================================
describe('POST /api/books - odd values', () => {
  test.failing('KNOWN DEFECT: an empty-text price is refused', async () => {
    // KNOWN DEFECT: "" passes the "is it missing" check and Number("") is 0, so the book is saved free.
    const res = await request(app).post('/api/books').set(adminAuth()).send({ ...goodBook, price: '' });
    expect(res.status).toBe(400);
    expect(Book.create).not.toHaveBeenCalled();
  });

  test.failing('KNOWN DEFECT: an empty-text stock is refused', async () => {
    // KNOWN DEFECT: "" passes the "is it missing" check and is saved as 0 stock.
    const res = await request(app).post('/api/books').set(adminAuth()).send({ ...goodBook, stock: '' });
    expect(res.status).toBe(400);
  });

  test('a book is saved with the ISBN trimmed', async () => {
    const res = await request(app).post('/api/books').set(adminAuth()).send({ ...goodBook, isbn: ' 978-1 ' });
    expect(res.status).toBe(201);
    expect(Book.findOne).toHaveBeenCalledWith({ isbn: '978-1' });
  });
});

// =====================================================================
// Books: PATCH /api/books/:id/stock (admin stock change)
// =====================================================================
describe('PATCH /api/books/:id/stock - value rules', () => {
  const patch = (stock) => request(app).patch(`/api/books/${BOOK_ID}/stock`).set(adminAuth()).send({ stock });

  test('a whole number sent as text ("5") is accepted and stored as a number', async () => {
    const res = await patch('5');
    expect(res.status).toBe(200);
    expect(Book.findOneAndUpdate.mock.calls[0][1]).toEqual({ $set: { stock: 5 } });
  });

  test('0 is accepted (marks the book out of stock)', async () => {
    const res = await patch(0);
    expect(res.status).toBe(200);
  });

  test.each([[2.5], [-1], ['abc'], ['   '], [true], [null], ['']])('stock %p is refused with 400', async (value) => {
    const res = await patch(value);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Stock must be a whole number, 0 or more');
    expect(Book.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('a request with no body is refused', async () => {
    const res = await request(app).patch(`/api/books/${BOOK_ID}/stock`).set(adminAuth());
    expect(res.status).toBe(400);
  });

  test('an invalid book id is refused before the database is used', async () => {
    const res = await request(app).patch('/api/books/xyz/stock').set(adminAuth()).send({ stock: 3 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid book id');
    expect(Book.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('an unknown book gives 404', async () => {
    Book.findOneAndUpdate.mockResolvedValue(null);
    const res = await patch(3);
    expect(res.status).toBe(404);
  });

  test('a customer cannot change stock (403)', async () => {
    const customer = { Authorization: `Bearer ${jwt.sign({ id: 'u9', role: 'customer' }, process.env.JWT_SECRET)}` };
    const res = await request(app).patch(`/api/books/${BOOK_ID}/stock`).set(customer).send({ stock: 3 });
    expect(res.status).toBe(403);
    expect(Book.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
