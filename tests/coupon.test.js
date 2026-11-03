// tests/coupon.test.js - coupon rules (pure functions) and the coupon API routes.
// No MongoDB is used: the Coupon and Book models are replaced with mocks.
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret';

jest.mock('../models/Coupon', () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));
jest.mock('../models/Book', () => ({ findById: jest.fn() }));

const Coupon = require('../models/Coupon');
const Book = require('../models/Book');
const couponRoutes = require('../routes/coupons');
const { evaluateCoupon, normalizeCode, CouponError } = require('../services/coupon');

const app = express();
app.use(express.json());
app.use('/api/coupons', couponRoutes);

const BOOK_ID = '64b7f0f2f2f2f2f2f2f2f2f1';
const DAY = 86400000;
const now = new Date();

function makeCoupon(overrides = {}) {
  return {
    _id: 'c1',
    code: 'SAVE10',
    type: 'percentage',
    value: 10,
    minPurchase: 0,
    maxDiscount: null,
    validFrom: null,
    validUntil: null,
    usageLimit: null,
    usedCount: 0,
    active: true,
    ...overrides,
  };
}

const tokenFor = (role) => jwt.sign({ id: 'u1', role }, process.env.JWT_SECRET);

beforeEach(() => {
  jest.resetAllMocks();
  Book.findById.mockResolvedValue({ _id: BOOK_ID, title: 'Clean Code', price: 500, stock: 10 });
});

// =====================================================================
// 1. Pure coupon rules
// =====================================================================
describe('evaluateCoupon - discount calculation', () => {
  test('percentage coupon takes the percentage off the subtotal', () => {
    expect(evaluateCoupon(makeCoupon({ value: 10 }), 1000, now)).toEqual({ discount: 100, total: 900 });
  });

  test('percentage discount is capped by maxDiscount', () => {
    // 20% of 1000 = 200, but the cap is 150
    const result = evaluateCoupon(makeCoupon({ value: 20, maxDiscount: 150 }), 1000, now);
    expect(result).toEqual({ discount: 150, total: 850 });
  });

  test('fixed-amount coupon subtracts the amount', () => {
    const coupon = makeCoupon({ type: 'fixed', value: 100 });
    expect(evaluateCoupon(coupon, 500, now)).toEqual({ discount: 100, total: 400 });
  });

  test('fixed coupon larger than the subtotal never makes the total negative', () => {
    const coupon = makeCoupon({ type: 'fixed', value: 800 });
    expect(evaluateCoupon(coupon, 500, now)).toEqual({ discount: 500, total: 0 });
  });

  test('discount is rounded to 2 decimals', () => {
    // 10% of 199.99 = 19.999 -> 20.00
    expect(evaluateCoupon(makeCoupon({ value: 10 }), 199.99, now)).toEqual({ discount: 20, total: 179.99 });
  });
});

describe('evaluateCoupon - eligibility rules', () => {
  test('rejects a missing coupon', () => {
    expect(() => evaluateCoupon(null, 500, now)).toThrow(CouponError);
    expect(() => evaluateCoupon(null, 500, now)).toThrow('Coupon code not found');
  });

  test('rejects an inactive coupon', () => {
    expect(() => evaluateCoupon(makeCoupon({ active: false }), 500, now)).toThrow('This coupon is not active');
  });

  test('rejects an expired coupon', () => {
    const coupon = makeCoupon({ validUntil: new Date(now.getTime() - DAY) });
    expect(() => evaluateCoupon(coupon, 500, now)).toThrow('This coupon has expired');
  });

  test('rejects a coupon that is not valid yet', () => {
    const coupon = makeCoupon({ validFrom: new Date(now.getTime() + DAY) });
    expect(() => evaluateCoupon(coupon, 500, now)).toThrow('This coupon is not valid yet');
  });

  test('accepts a coupon inside its validity window', () => {
    const coupon = makeCoupon({
      validFrom: new Date(now.getTime() - DAY),
      validUntil: new Date(now.getTime() + DAY),
    });
    expect(evaluateCoupon(coupon, 500, now).discount).toBe(50);
  });

  test('rejects a coupon whose usage limit is used up', () => {
    const coupon = makeCoupon({ usageLimit: 5, usedCount: 5 });
    expect(() => evaluateCoupon(coupon, 500, now)).toThrow('This coupon has reached its usage limit');
  });

  test('rejects a cart below the minimum purchase amount', () => {
    const coupon = makeCoupon({ minPurchase: 800 });
    expect(() => evaluateCoupon(coupon, 500, now)).toThrow('A minimum purchase of ₹800 is required');
  });

  test('accepts a cart exactly at the minimum purchase amount', () => {
    const coupon = makeCoupon({ minPurchase: 500 });
    expect(evaluateCoupon(coupon, 500, now).discount).toBe(50);
  });
});

describe('normalizeCode', () => {
  test('trims spaces and converts to upper case', () => {
    expect(normalizeCode('  save10 ')).toBe('SAVE10');
  });

  test('empty input becomes an empty string', () => {
    expect(normalizeCode(undefined)).toBe('');
  });
});

// =====================================================================
// 2. POST /api/coupons/validate (checkout preview)
// =====================================================================
describe('POST /api/coupons/validate', () => {
  test('calculates the discount from DATABASE prices, ignoring prices sent by the browser', async () => {
    Coupon.findOne.mockResolvedValue(makeCoupon({ value: 10 }));

    const res = await request(app)
      .post('/api/coupons/validate')
      .send({
        couponCode: 'save10',
        items: [{ bookId: BOOK_ID, quantity: 2, price: 1 }], // fake price 1 is ignored
      });

    expect(res.status).toBe(200);
    expect(Coupon.findOne).toHaveBeenCalledWith({ code: 'SAVE10' });
    expect(res.body).toMatchObject({ code: 'SAVE10', subtotal: 1000, discount: 100, total: 900 });
  });

  test('returns a clear message for an expired coupon', async () => {
    Coupon.findOne.mockResolvedValue(makeCoupon({ validUntil: new Date(Date.now() - DAY) }));

    const res = await request(app)
      .post('/api/coupons/validate')
      .send({ couponCode: 'SAVE10', items: [{ bookId: BOOK_ID, quantity: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('This coupon has expired');
  });

  test('returns 400 for an unknown code', async () => {
    Coupon.findOne.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/coupons/validate')
      .send({ couponCode: 'NOPE', items: [{ bookId: BOOK_ID, quantity: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Coupon code not found');
  });

  test('asks for a code when none is sent', async () => {
    const res = await request(app)
      .post('/api/coupons/validate')
      .send({ items: [{ bookId: BOOK_ID, quantity: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Please enter a coupon code');
    expect(Coupon.findOne).not.toHaveBeenCalled();
  });

  test('reports stock problems for the cart before checking the coupon', async () => {
    Book.findById.mockResolvedValue({ _id: BOOK_ID, title: 'Clean Code', price: 500, stock: 1 });

    const res = await request(app)
      .post('/api/coupons/validate')
      .send({ couponCode: 'SAVE10', items: [{ bookId: BOOK_ID, quantity: 3 }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Only 1 copies of "Clean Code" are in stock');
  });
});

// =====================================================================
// 3. Admin coupon management: access control and validation
// =====================================================================
describe('coupon admin routes - access control', () => {
  const validCoupon = { code: 'WELCOME', type: 'fixed', value: 50 };

  test('rejects a request with no token (401)', async () => {
    const res = await request(app).post('/api/coupons').send(validCoupon);
    expect(res.status).toBe(401);
    expect(Coupon.create).not.toHaveBeenCalled();
  });

  test('rejects a customer (403)', async () => {
    const res = await request(app)
      .post('/api/coupons')
      .set('Authorization', `Bearer ${tokenFor('customer')}`)
      .send(validCoupon);
    expect(res.status).toBe(403);
    expect(Coupon.create).not.toHaveBeenCalled();
  });

  test('allows an admin to create a coupon (201)', async () => {
    Coupon.create.mockImplementation(async (data) => ({ _id: 'c2', ...data }));

    const res = await request(app)
      .post('/api/coupons')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send(validCoupon);

    expect(res.status).toBe(201);
    expect(res.body.code).toBe('WELCOME');
    expect(Coupon.create.mock.calls[0][0]).toMatchObject({ code: 'WELCOME', type: 'fixed', value: 50, active: true });
  });
});

describe('coupon admin routes - input validation', () => {
  const adminAuth = () => `Bearer ${tokenFor('admin')}`;

  test('rejects a percentage above 100', async () => {
    const res = await request(app)
      .post('/api/coupons')
      .set('Authorization', adminAuth())
      .send({ code: 'BIG', type: 'percentage', value: 150 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('A percentage discount cannot be more than 100');
    expect(Coupon.create).not.toHaveBeenCalled();
  });

  test('rejects a code with spaces or symbols', async () => {
    const res = await request(app)
      .post('/api/coupons')
      .set('Authorization', adminAuth())
      .send({ code: 'BAD CODE!', type: 'fixed', value: 10 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Code must be 3-20 letters, numbers, dashes or underscores');
  });

  test('rejects "valid from" after "valid until"', async () => {
    const res = await request(app)
      .post('/api/coupons')
      .set('Authorization', adminAuth())
      .send({
        code: 'DATES',
        type: 'fixed',
        value: 10,
        validFrom: '2030-02-01',
        validUntil: '2030-01-01',
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('"Valid from" must be before "valid until"');
  });

  test('deactivating a coupon changes only the active flag', async () => {
    Coupon.findByIdAndUpdate.mockResolvedValue({ _id: BOOK_ID, code: 'SAVE10', active: false });

    const res = await request(app)
      .patch(`/api/coupons/${BOOK_ID}/status`)
      .set('Authorization', adminAuth())
      .send({ active: false });

    expect(res.status).toBe(200);
    expect(Coupon.findByIdAndUpdate.mock.calls[0][1]).toEqual({ active: false });
  });
});
