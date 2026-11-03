// tests/orders-coupon.test.js - coupon handling inside POST /api/orders.
// MongoDB is NOT used: Book, User, Order and Coupon are replaced with mocks.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const jwt = require('jsonwebtoken');
const request = require('supertest');
const express = require('express');

jest.mock('../models/Book', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() }));
jest.mock('../models/User', () => ({ findById: jest.fn() }));
jest.mock('../models/Order', () => ({ create: jest.fn() }));
jest.mock('../models/Coupon', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));

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
const BOOK_ID = '64b7f0f2f2f2f2f2f2f2f2f1';
const validAddress = {
  fullName: 'Vajra', address: '12 Main Street', city: 'Coimbatore', pincode: '641001', phone: '9876543210',
};

const book = () => ({ _id: BOOK_ID, title: 'Clean Code', price: 500, stock: 10, save: jest.fn().mockResolvedValue() });

const coupon = (overrides = {}) => ({
  _id: 'c1', code: 'SAVE10', type: 'percentage', value: 10, minPurchase: 0, maxDiscount: null,
  validFrom: null, validUntil: null, usageLimit: null, usedCount: 0, active: true, ...overrides,
});

const post = (body) => request(app).post('/api/orders')
  .set('Authorization', `Bearer ${jwt.sign({ id: USER_ID, role: 'customer' }, process.env.JWT_SECRET)}`)
  .send({
  userId: USER_ID,
  items: [{ bookId: BOOK_ID, quantity: 2 }],   // 2 x 500 = 1000
  shippingAddress: validAddress,
  ...body,
});

beforeEach(() => {
  jest.resetAllMocks();
  User.findById.mockResolvedValue({ _id: USER_ID });
  installFakeBooks(Book, [book()]);
  Order.create.mockImplementation(async (data) => ({ _id: 'order-1', ...data }));
  Coupon.findOne.mockResolvedValue(coupon());
  Coupon.findOneAndUpdate.mockResolvedValue(coupon({ usedCount: 1 })); // reservation succeeded
});

describe('POST /api/orders with a coupon', () => {
  test('applies the discount and stores the coupon details on the order', async () => {
    const res = await post({ couponCode: 'save10' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ subtotal: 1000, discount: 100, total: 900 });

    const saved = Order.create.mock.calls[0][0];
    expect(saved).toMatchObject({ subtotal: 1000, couponCode: 'SAVE10', discountAmount: 100, total: 900 });
  });

  test('uses up one coupon use when the order is placed', async () => {
    await post({ couponCode: 'SAVE10' });

    expect(Coupon.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(Coupon.findOneAndUpdate.mock.calls[0][1]).toEqual({ $inc: { usedCount: 1 } });
  });

  test('ignores a discount amount sent by the browser', async () => {
    const res = await post({ couponCode: 'SAVE10', discountAmount: 9999, total: 1 });

    expect(res.body.discount).toBe(100);
    expect(res.body.total).toBe(900);
    expect(Order.create.mock.calls[0][0].discountAmount).toBe(100);
  });

  test('rejects an expired coupon without creating an order or reducing stock', async () => {
    Coupon.findOne.mockResolvedValue(coupon({ validUntil: new Date(Date.now() - 86400000) }));
    const b = book();
    installFakeBooks(Book, [b]);

    const res = await post({ couponCode: 'SAVE10' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('This coupon has expired');
    expect(Order.create).not.toHaveBeenCalled();
    expect(Book.findOneAndUpdate).not.toHaveBeenCalled();
    expect(b.stock).toBe(10);
    expect(Coupon.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('rejects an order when the last coupon use was taken by someone else', async () => {
    Coupon.findOneAndUpdate.mockResolvedValue(null); // limit reached at the moment of reservation

    const res = await post({ couponCode: 'SAVE10' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('This coupon has reached its usage limit');
    expect(Order.create).not.toHaveBeenCalled();
  });

  test('gives the coupon use back if the order cannot be saved', async () => {
    Order.create.mockRejectedValue(new Error('database down'));

    const res = await post({ couponCode: 'SAVE10' });

    expect(res.status).toBe(500);
    expect(Coupon.updateOne).toHaveBeenCalledWith({ _id: 'c1' }, { $inc: { usedCount: -1 } });
  });

  test('places a normal order without touching coupons when no code is sent', async () => {
    const res = await post({});

    expect(res.status).toBe(201);
    expect(res.body.total).toBe(1000);
    expect(Coupon.findOne).not.toHaveBeenCalled();
    expect(Order.create.mock.calls[0][0].couponCode).toBeNull();
  });
});
