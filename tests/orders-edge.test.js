// tests/orders-edge.test.js - edge cases for placing orders (POST /api/orders)
// and for cancel/refund status changes (PATCH /api/orders/:id/status).
// Extra cases on top of orders.test.js, orders-coupon.test.js and inventory.test.js.
// No MongoDB: User, Book, Order and Coupon are mocked (installFakeBooks mimics stock updates).
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';           // the confirmation email is skipped under Jest
const jwt = require('jsonwebtoken');
const request = require('supertest');
const express = require('express');

jest.mock('../models/Book', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() }));
jest.mock('../models/User', () => ({ findById: jest.fn() }));
jest.mock('../models/Order', () => ({ create: jest.fn(), findOneAndUpdate: jest.fn(), findById: jest.fn(), updateOne: jest.fn() }));
jest.mock('../models/Coupon', () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() }));

const Book = require('../models/Book');
const User = require('../models/User');
const Order = require('../models/Order');
const Coupon = require('../models/Coupon');
const ordersRouter = require('../routes/orders');
const { installFakeBooks } = require('./helpers/fakeBooks');

const app = express();
app.use(express.json());
app.use('/api/orders', ordersRouter);

const USER_ID = '64b7f0f2f2f2f2f2f2f2f2a1';
const ADMIN_ID = '64b7f0f2f2f2f2f2f2f2f2a9';
const BOOK_1 = '64b7f0f2f2f2f2f2f2f2f2f1';
const BOOK_2 = '64b7f0f2f2f2f2f2f2f2f2f2';
const ORDER_ID = '64b7f0f2f2f2f2f2f2f2f2e1';

const address = { fullName: 'Vajra', address: '12 Main Street', city: 'Coimbatore', pincode: '641001', phone: '9876543210' };
const customerToken = () => jwt.sign({ id: USER_ID, role: 'customer' }, process.env.JWT_SECRET);
const adminToken = () => jwt.sign({ id: ADMIN_ID, role: 'admin' }, process.env.JWT_SECRET);

function makeBook(overrides) {
  return { _id: BOOK_1, title: 'Clean Code', price: 500, stock: 10, ...overrides };
}

function postOrder(body) {
  return request(app).post('/api/orders').set('Authorization', `Bearer ${customerToken()}`).send(body);
}

function patchStatus(id, body, token = adminToken()) {
  return request(app).patch(`/api/orders/${id}/status`).set('Authorization', `Bearer ${token}`).send(body);
}

let books;
beforeEach(() => {
  jest.resetAllMocks();
  User.findById.mockResolvedValue({ _id: USER_ID, name: 'Vajra', email: 'vajra@example.com' });
  Order.create.mockImplementation(async (data) => ({ _id: ORDER_ID, ...data }));
  Order.updateOne.mockResolvedValue({});
  Coupon.findOne.mockResolvedValue(null);
  books = [makeBook(), makeBook({ _id: BOOK_2, title: 'The Pragmatic Programmer', price: 300, stock: 4 })];
  installFakeBooks(Book, books);
});

// =====================================================================
// Placing orders: edge cases
// =====================================================================
describe('POST /api/orders - quantities and cart shape', () => {
  test('a quantity sent as text ("2") is accepted and saved as a number', async () => {
    const res = await postOrder({ items: [{ bookId: BOOK_1, quantity: '2' }], shippingAddress: address });
    expect(res.status).toBe(201);
    const saved = Order.create.mock.calls[0][0];
    expect(saved.items[0].quantity).toBe(2);
    expect(saved.total).toBe(1000);
  });

  test('a fractional quantity is rejected with "Invalid item in cart"', async () => {
    const res = await postOrder({ items: [{ bookId: BOOK_1, quantity: 2.5 }], shippingAddress: address });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid item in cart');
    expect(Order.create).not.toHaveBeenCalled();
  });

  test('an items value that is not an array is treated as an empty cart', async () => {
    const res = await postOrder({ items: { bookId: BOOK_1, quantity: 1 }, shippingAddress: address });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Cart is empty');
  });

  test('the same book on two lines is priced on both lines', async () => {
    const res = await postOrder({
      items: [{ bookId: BOOK_1, quantity: 1 }, { bookId: BOOK_1, quantity: 2 }],
      shippingAddress: address,
    });
    expect(res.status).toBe(201);
    expect(res.body.subtotal).toBe(1500);
  });

  test('two lines for one book that together exceed stock are refused, and every copy is put back', async () => {
    // stock is 10; the cart asks for 6 + 6. Each line is fine alone, but together they are not.
    const res = await postOrder({
      items: [{ bookId: BOOK_1, quantity: 6 }, { bookId: BOOK_1, quantity: 6 }],
      shippingAddress: address,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Only 4 copies of "Clean Code" are in stock');
    expect(Order.create).not.toHaveBeenCalled();
    expect(books[0].stock).toBe(10);   // the first 6 taken were given back
  });

  test('an order with the exact stock of every book leaves those books at 0', async () => {
    const res = await postOrder({
      items: [{ bookId: BOOK_1, quantity: 10 }, { bookId: BOOK_2, quantity: 4 }],
      shippingAddress: address,
    });
    expect(res.status).toBe(201);
    expect(books.map((b) => b.stock)).toEqual([0, 0]);
  });
});

describe('POST /api/orders - shipping and coupon details', () => {
  test('a missing shipping address is rejected', async () => {
    const res = await postOrder({ items: [{ bookId: BOOK_1, quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Complete shipping address is required');
  });

  test('a shipping address without a phone number is rejected', async () => {
    const res = await postOrder({
      items: [{ bookId: BOOK_1, quantity: 1 }],
      shippingAddress: { ...address, phone: '' },
    });
    expect(res.status).toBe(400);
  });

  test('a coupon code sent in lower case still applies', async () => {
    Coupon.findOne.mockResolvedValue({ _id: 'c1', code: 'SAVE10', type: 'percentage', value: 10, active: true, usedCount: 0, usageLimit: null, minPurchase: 0, maxDiscount: null, validFrom: null, validUntil: null });
    Coupon.findOneAndUpdate.mockResolvedValue({ _id: 'c1', usedCount: 1 });
    const res = await postOrder({ items: [{ bookId: BOOK_1, quantity: 2 }], shippingAddress: address, couponCode: 'save10' });
    expect(res.status).toBe(201);
    expect(Coupon.findOne).toHaveBeenCalledWith({ code: 'SAVE10' });
    expect(res.body.discount).toBe(100);
  });

  test('a fixed coupon bigger than the cart makes the order total 0, never negative', async () => {
    Coupon.findOne.mockResolvedValue({ _id: 'c2', code: 'FLAT5000', type: 'fixed', value: 5000, active: true, usedCount: 0, usageLimit: null, minPurchase: 0, maxDiscount: null, validFrom: null, validUntil: null });
    Coupon.findOneAndUpdate.mockResolvedValue({ _id: 'c2', usedCount: 1 });
    const res = await postOrder({ items: [{ bookId: BOOK_1, quantity: 1 }], shippingAddress: address, couponCode: 'FLAT5000' });
    expect(res.status).toBe(201);
    expect(res.body.total).toBe(0);
    expect(res.body.discount).toBe(500);
  });

  test('the confirmation email step is skipped under test and the response says so', async () => {
    const res = await postOrder({ items: [{ bookId: BOOK_1, quantity: 1 }], shippingAddress: address });
    expect(res.body.emailStatus).toBe('skipped');
    expect(Order.updateOne).toHaveBeenCalledWith(
      { _id: ORDER_ID },
      { $set: expect.objectContaining({ emailStatus: 'skipped', emailSentAt: null }) }
    );
  });

  test('a saved order copies the title and price from the database at order time', async () => {
    await postOrder({ items: [{ bookId: BOOK_1, quantity: 1 }], shippingAddress: address });
    const line = Order.create.mock.calls[0][0].items[0];
    expect(line).toMatchObject({ title: 'Clean Code', price: 500 });
    expect(line.book).toBe(BOOK_1);
  });
});

// =====================================================================
// Cancel / refund: status rules and messages
// =====================================================================
describe('PATCH /api/orders/:id/status - request validation', () => {
  test('a request with no status is rejected', async () => {
    const res = await patchStatus(ORDER_ID, {});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Status must be Cancelled or Refunded');
  });

  test.each([['Placed'], ['cancelled'], ['REFUNDED'], ['Shipped']])('status "%s" is not allowed', async (status) => {
    const res = await patchStatus(ORDER_ID, { status });
    expect(res.status).toBe(400);
    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/orders/:id/status - cancelling a placed order', () => {
  test('the claim only matches a Placed (or old, status-less) order whose stock is not yet restored', async () => {
    Order.findOneAndUpdate.mockResolvedValue({ _id: ORDER_ID, status: 'Cancelled', items: [] });
    await patchStatus(ORDER_ID, { status: 'Cancelled' });
    expect(Order.findOneAndUpdate.mock.calls[0][0]).toEqual({
      _id: ORDER_ID,
      status: { $in: ['Placed', null] },
      stockRestored: { $ne: true },
    });
  });

  test('a successful cancel says so and puts each book back by its ordered quantity', async () => {
    Order.findOneAndUpdate.mockResolvedValue({
      _id: ORDER_ID,
      status: 'Cancelled',
      items: [{ book: BOOK_1, quantity: 2 }, { book: BOOK_2, quantity: 1 }],
    });
    const res = await patchStatus(ORDER_ID, { status: 'Cancelled' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Order cancelled and stock restored');
    expect(Book.updateOne.mock.calls).toEqual([
      [{ _id: BOOK_1 }, { $inc: { stock: 2 } }],
      [{ _id: BOOK_2 }, { $inc: { stock: 1 } }],
    ]);
  });

  test('a database error during cancel gives a safe 500', async () => {
    Order.findOneAndUpdate.mockRejectedValue(new Error('timeout'));
    const res = await patchStatus(ORDER_ID, { status: 'Cancelled' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Server error' });
  });

  test('cancelling an unknown order gives 404', async () => {
    Order.findOneAndUpdate.mockResolvedValue(null);
    Order.findById.mockResolvedValue(null);
    const res = await patchStatus(ORDER_ID, { status: 'Cancelled' });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Order not found');
  });
});

describe('PATCH /api/orders/:id/status - orders that already changed', () => {
  test('cancelling an already cancelled order says it is already cancelled and restores nothing', async () => {
    Order.findOneAndUpdate.mockResolvedValue(null);
    Order.findById.mockResolvedValue({ _id: ORDER_ID, status: 'Cancelled' });
    const res = await patchStatus(ORDER_ID, { status: 'Cancelled' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('This order is already cancelled');
    expect(Book.updateOne).not.toHaveBeenCalled();
  });

  test('refunding an already refunded order says it is already refunded', async () => {
    Order.findOneAndUpdate.mockResolvedValue(null);
    Order.findById.mockResolvedValue({ _id: ORDER_ID, status: 'Refunded' });
    const res = await patchStatus(ORDER_ID, { status: 'Refunded' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('This order is already refunded');
  });

  test('a refunded order cannot be cancelled', async () => {
    Order.findOneAndUpdate.mockResolvedValue(null);
    Order.findById.mockResolvedValue({ _id: ORDER_ID, status: 'Refunded' });
    const res = await patchStatus(ORDER_ID, { status: 'Cancelled' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('This order is already refunded');
    expect(Book.updateOne).not.toHaveBeenCalled();
  });

  test('a cancelled order marked refunded keeps its stock where it is (no second restore)', async () => {
    Order.findOneAndUpdate
      .mockResolvedValueOnce(null)                                              // claim fails: not Placed
      .mockResolvedValueOnce({ _id: ORDER_ID, status: 'Refunded', items: [] }); // refund step succeeds
    Order.findById.mockResolvedValue({ _id: ORDER_ID, status: 'Cancelled' });

    const res = await patchStatus(ORDER_ID, { status: 'Refunded' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Order marked as refunded. Stock was already restored');
    expect(Book.updateOne).not.toHaveBeenCalled();
  });

  test('a refund of a placed order restores stock and says so', async () => {
    Order.findOneAndUpdate.mockResolvedValue({
      _id: ORDER_ID, status: 'Refunded', items: [{ book: BOOK_2, quantity: 3 }],
    });
    const res = await patchStatus(ORDER_ID, { status: 'Refunded' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Order refunded and stock restored');
    expect(Book.updateOne).toHaveBeenCalledWith({ _id: BOOK_2 }, { $inc: { stock: 3 } });
  });
});
