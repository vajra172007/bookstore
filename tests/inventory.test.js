// tests/inventory.test.js - Phase 2: atomic stock, checkout stock validation,
// restore on cancel/refund (only once), admin stock update.
// MongoDB is NOT used: models are mocks that behave like the real conditional updates.
process.env.JWT_SECRET = 'test-secret-for-inventory';

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

jest.mock('../models/Book', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() }));
jest.mock('../models/User', () => ({ findById: jest.fn() }));
jest.mock('../models/Order', () => ({
  create: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn(),
}));
jest.mock('../models/Coupon', () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() }));

const Book = require('../models/Book');
const User = require('../models/User');
const Order = require('../models/Order');
const Coupon = require('../models/Coupon');
const ordersRouter = require('../routes/orders');
const booksRouter = require('../routes/books');
const { installFakeBooks } = require('./helpers/fakeBooks');

const app = express();
app.use(express.json());
app.use('/api/orders', ordersRouter);
app.use('/api/books', booksRouter);

const USER_ID = '64b7f0f2f2f2f2f2f2f2f2a1';
const BOOK_1 = '64b7f0f2f2f2f2f2f2f2f2f1';
const BOOK_2 = '64b7f0f2f2f2f2f2f2f2f2f2';
const ORDER_ID = '64b7f0f2f2f2f2f2f2f2f2c1';
const address = { fullName: 'Vajra', address: '12 Main Street', city: 'Coimbatore', pincode: '641001', phone: '9876543210' };

const makeBook = (id, stock, overrides = {}) => ({ _id: id, title: `Book ${id.slice(-1)}`, price: 100, stock, ...overrides });
const token = (role) => jwt.sign({ id: USER_ID, role }, process.env.JWT_SECRET);
const adminAuth = () => ({ Authorization: `Bearer ${token('admin')}` });

const placeOrder = (items, extra = {}) =>
  request(app).post('/api/orders').set('Authorization', `Bearer ${token('customer')}`)
    .send({ items, shippingAddress: address, ...extra });

beforeEach(() => {
  jest.resetAllMocks();
  User.findById.mockResolvedValue({ _id: USER_ID });
  Order.create.mockImplementation(async (data) => ({ _id: ORDER_ID, ...data }));
});

// =====================================================================
describe('checkout: atomic stock reduction', () => {
  test('uses one conditional update per book (stock must be >= quantity)', async () => {
    const book = makeBook(BOOK_1, 10);
    installFakeBooks(Book, [book]);

    const res = await placeOrder([{ bookId: BOOK_1, quantity: 3 }]);

    expect(res.status).toBe(201);
    expect(Book.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: BOOK_1, stock: { $gte: 3 } },
      { $inc: { stock: -3 } },
      { new: true }
    );
    expect(book.stock).toBe(7);
  });

  test('rejects an out-of-stock book at checkout and creates no order', async () => {
    const book = makeBook(BOOK_1, 0);
    installFakeBooks(Book, [book]);

    const res = await placeOrder([{ bookId: BOOK_1, quantity: 1 }]);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Only 0 copies of "Book 1" are in stock');
    expect(Order.create).not.toHaveBeenCalled();
    expect(Book.findOneAndUpdate).not.toHaveBeenCalled();
    expect(book.stock).toBe(0);
  });

  test('rejects when stock disappears between the check and the update (race)', async () => {
    const book = makeBook(BOOK_1, 2);
    installFakeBooks(Book, [book]);
    // The cart check sees 2 copies, but another buyer takes them before our update runs
    Book.findOneAndUpdate.mockImplementationOnce(async () => {
      book.stock = 0;
      return null;
    });

    const res = await placeOrder([{ bookId: BOOK_1, quantity: 2 }]);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('"Book 1" is out of stock');
    expect(Order.create).not.toHaveBeenCalled();
    expect(book.stock).toBe(0);
  });

  test('says how many copies are left when only some remain after the race', async () => {
    const book = makeBook(BOOK_1, 5);
    installFakeBooks(Book, [book]);
    Book.findOneAndUpdate.mockImplementationOnce(async () => {
      book.stock = 1;
      return null;
    });

    const res = await placeOrder([{ bookId: BOOK_1, quantity: 4 }]);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Only 1 copy of "Book 1" are in stock');
  });

  test('two buyers for the last copy: exactly one order succeeds, stock never goes negative', async () => {
    const book = makeBook(BOOK_1, 1);
    installFakeBooks(Book, [book]);

    const [a, b] = await Promise.all([
      placeOrder([{ bookId: BOOK_1, quantity: 1 }]),
      placeOrder([{ bookId: BOOK_1, quantity: 1 }]),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect(book.stock).toBe(0);
    expect(Order.create).toHaveBeenCalledTimes(1);
  });

  test('multi-book order: if the second book fails, the first book is put back', async () => {
    const b1 = makeBook(BOOK_1, 10);
    const b2 = makeBook(BOOK_2, 3);
    installFakeBooks(Book, [b1, b2]);
    // Second book is sold out by someone else right before our update
    const original = Book.findOneAndUpdate.getMockImplementation();
    Book.findOneAndUpdate.mockImplementation(async (filter, update, opts) => {
      if (String(filter._id) === BOOK_2) {
        b2.stock = 0;
      }
      return original(filter, update, opts);
    });

    const res = await placeOrder([{ bookId: BOOK_1, quantity: 4 }, { bookId: BOOK_2, quantity: 2 }]);

    expect(res.status).toBe(400);
    expect(b1.stock).toBe(10);   // rolled back
    expect(b2.stock).toBe(0);
    expect(Order.create).not.toHaveBeenCalled();
  });

  test('gives the stock back if the order cannot be saved', async () => {
    const book = makeBook(BOOK_1, 10);
    installFakeBooks(Book, [book]);
    Order.create.mockRejectedValue(new Error('database down'));

    const res = await placeOrder([{ bookId: BOOK_1, quantity: 3 }]);

    expect(res.status).toBe(500);
    expect(book.stock).toBe(10);
  });

  test('coupon use is given back when stock runs out at the last moment', async () => {
    const book = makeBook(BOOK_1, 2);
    installFakeBooks(Book, [book]);
    Book.findOneAndUpdate.mockImplementationOnce(async () => {
      book.stock = 0;
      return null;
    });
    Coupon.findOne.mockResolvedValue({
      _id: 'c1', code: 'SAVE10', type: 'percentage', value: 10, minPurchase: 0, maxDiscount: null,
      validFrom: null, validUntil: null, usageLimit: null, usedCount: 0, active: true,
    });
    Coupon.findOneAndUpdate.mockResolvedValue({ _id: 'c1', usedCount: 1 });

    const res = await placeOrder([{ bookId: BOOK_1, quantity: 2 }], { couponCode: 'SAVE10' });

    expect(res.status).toBe(400);
    expect(Coupon.updateOne).toHaveBeenCalledWith({ _id: 'c1' }, { $inc: { usedCount: -1 } });
  });

  test('a successful coupon order still works and reduces stock', async () => {
    const book = makeBook(BOOK_1, 10, { price: 500 });
    installFakeBooks(Book, [book]);
    Coupon.findOne.mockResolvedValue({
      _id: 'c1', code: 'SAVE10', type: 'percentage', value: 10, minPurchase: 0, maxDiscount: null,
      validFrom: null, validUntil: null, usageLimit: null, usedCount: 0, active: true,
    });
    Coupon.findOneAndUpdate.mockResolvedValue({ _id: 'c1', usedCount: 1 });

    const res = await placeOrder([{ bookId: BOOK_1, quantity: 2 }], { couponCode: 'SAVE10' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ subtotal: 1000, discount: 100, total: 900 });
    expect(book.stock).toBe(8);
  });
});

// =====================================================================
// A tiny in-memory order that follows the same rules as the real conditional update
function installFakeOrder(order) {
  const matches = (o, f) =>
    String(o._id) === String(f._id) &&
    (!f.status || (f.status.$in ? f.status.$in.includes(o.status === undefined ? null : o.status) : f.status === o.status)) &&
    (!f.stockRestored || o.stockRestored !== true);

  Order.findById.mockImplementation(async (id) => (String(id) === String(order._id) ? order : null));
  Order.findOneAndUpdate.mockImplementation(async (filter, update) => {
    if (!matches(order, filter)) return null;
    Object.assign(order, update.$set);
    return order;
  });
  Order.updateOne.mockImplementation(async (filter, update) => {
    if (String(filter._id) === String(order._id)) Object.assign(order, update.$set);
    return { modifiedCount: 1 };
  });
}

const placedOrder = (overrides = {}) => ({
  _id: ORDER_ID,
  status: 'Placed',
  stockRestored: false,
  items: [{ book: BOOK_1, quantity: 3 }, { book: BOOK_2, quantity: 1 }],
  ...overrides,
});

const setStatus = (status, headers = adminAuth(), id = ORDER_ID) =>
  request(app).patch(`/api/orders/${id}/status`).set(headers).send({ status });

describe('PATCH /api/orders/:id/status - access and validation', () => {
  test('requires login', async () => {
    const res = await request(app).patch(`/api/orders/${ORDER_ID}/status`).send({ status: 'Cancelled' });
    expect(res.status).toBe(401);
  });

  test('customers are not allowed', async () => {
    const res = await setStatus('Cancelled', { Authorization: `Bearer ${token('customer')}` });
    expect(res.status).toBe(403);
    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('staff are allowed', async () => {
    installFakeBooks(Book, [makeBook(BOOK_1, 0), makeBook(BOOK_2, 0)]);
    installFakeOrder(placedOrder());
    const res = await setStatus('Cancelled', { Authorization: `Bearer ${token('staff')}` });
    expect(res.status).toBe(200);
  });

  test('rejects an invalid order id', async () => {
    const res = await setStatus('Cancelled', adminAuth(), 'abc');
    expect(res.status).toBe(400);
  });

  test('rejects an unknown status', async () => {
    const res = await setStatus('Shipped');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Status must be Cancelled or Refunded');
  });

  test('returns 404 for an order that does not exist', async () => {
    Order.findOneAndUpdate.mockResolvedValue(null);
    Order.findById.mockResolvedValue(null);
    const res = await setStatus('Cancelled');
    expect(res.status).toBe(404);
  });
});

describe('cancel / refund restores stock exactly once', () => {
  let b1;
  let b2;
  let order;

  beforeEach(() => {
    b1 = makeBook(BOOK_1, 5);
    b2 = makeBook(BOOK_2, 0);
    installFakeBooks(Book, [b1, b2]);
    order = placedOrder();
    installFakeOrder(order);
  });

  test('cancelling a placed order puts every book back in stock', async () => {
    const res = await setStatus('Cancelled');

    expect(res.status).toBe(200);
    expect(b1.stock).toBe(8);   // 5 + 3
    expect(b2.stock).toBe(1);   // 0 + 1
    expect(order).toMatchObject({ status: 'Cancelled', stockRestored: true });
    expect(Book.updateOne).toHaveBeenCalledWith({ _id: BOOK_1 }, { $inc: { stock: 3 } });
  });

  test('refunding a placed order restores stock too', async () => {
    const res = await setStatus('Refunded');

    expect(res.status).toBe(200);
    expect(b1.stock).toBe(8);
    expect(order.status).toBe('Refunded');
  });

  test('cancelling twice does not restore twice', async () => {
    await setStatus('Cancelled');
    const second = await setStatus('Cancelled');

    expect(second.status).toBe(400);
    expect(second.body.message).toBe('This order is already cancelled');
    expect(b1.stock).toBe(8);
    expect(b2.stock).toBe(1);
  });

  test('two simultaneous cancel requests restore stock only once', async () => {
    const [a, b] = await Promise.all([setStatus('Cancelled'), setStatus('Cancelled')]);

    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect(b1.stock).toBe(8);
    expect(b2.stock).toBe(1);
  });

  test('refunding an already cancelled order changes the status but does not restore again', async () => {
    await setStatus('Cancelled');
    const res = await setStatus('Refunded');

    expect(res.status).toBe(200);
    expect(order.status).toBe('Refunded');
    expect(b1.stock).toBe(8);   // not 11
    expect(b2.stock).toBe(1);
  });

  test('a refunded order cannot be cancelled or refunded again', async () => {
    await setStatus('Refunded');

    expect((await setStatus('Cancelled')).status).toBe(400);
    expect((await setStatus('Refunded')).status).toBe(400);
    expect(b1.stock).toBe(8);
  });

  test('an old order with no status field is treated as placed', async () => {
    order.status = undefined;
    const res = await setStatus('Cancelled');
    expect(res.status).toBe(200);
    expect(b1.stock).toBe(8);
  });

  test('if the second book fails to restore, the first is undone so a retry cannot double count', async () => {
    Book.updateOne
      .mockImplementationOnce(async (f, u) => { b1.stock += u.$inc.stock; return {}; })   // first book restored
      .mockRejectedValueOnce(new Error('database down'));                              // second fails

    const res = await setStatus('Cancelled');

    expect(res.status).toBe(500);
    expect(b1.stock).toBe(5);   // undone
    expect(b2.stock).toBe(0);
    expect(order).toMatchObject({ status: 'Placed', stockRestored: false });
  });

  test('if restoring fails, the order goes back to Placed so it can be retried', async () => {
    Book.updateOne.mockRejectedValueOnce(new Error('database down'));

    const res = await setStatus('Cancelled');

    expect(res.status).toBe(500);
    expect(order).toMatchObject({ status: 'Placed', stockRestored: false });

    // retry works and restores once
    const retry = await setStatus('Cancelled');
    expect(retry.status).toBe(200);
    expect(order.stockRestored).toBe(true);
  });
});

// =====================================================================
describe('PATCH /api/books/:id/stock - admin inventory update', () => {
  const patch = (body, headers = adminAuth(), id = BOOK_1) =>
    request(app).patch(`/api/books/${id}/stock`).set(headers).send(body);

  test('requires login and admin/staff role', async () => {
    expect((await request(app).patch(`/api/books/${BOOK_1}/stock`).send({ stock: 5 })).status).toBe(401);
    expect((await patch({ stock: 5 }, { Authorization: `Bearer ${token('customer')}` })).status).toBe(403);
  });

  test('sets the stock with one atomic update', async () => {
    Book.findOneAndUpdate.mockResolvedValue(makeBook(BOOK_1, 25));

    const res = await patch({ stock: 25 });

    expect(res.status).toBe(200);
    expect(Book.findOneAndUpdate).toHaveBeenCalledWith({ _id: BOOK_1 }, { $set: { stock: 25 } }, { new: true });
    expect(res.body.book.stock).toBe(25);
  });

  test('allows setting stock to 0 (out of stock)', async () => {
    Book.findOneAndUpdate.mockResolvedValue(makeBook(BOOK_1, 0));
    expect((await patch({ stock: 0 })).status).toBe(200);
  });

  test.each([[-1], [1.5], ['abc'], [''], [null]])('rejects invalid stock %p', async (value) => {
    const res = await patch({ stock: value });
    expect(res.status).toBe(400);
    expect(Book.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('rejects a missing stock value and a bad id', async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ stock: 5 }, adminAuth(), 'bad')).status).toBe(400);
  });

  test('returns 404 for an unknown book', async () => {
    Book.findOneAndUpdate.mockResolvedValue(null);
    expect((await patch({ stock: 5 })).status).toBe(404);
  });
});
