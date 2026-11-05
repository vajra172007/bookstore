// tests/coupon-admin.test.js - coupon admin routes (create, edit, activate) and the checkout preview.
// Extra cases on top of tests/coupon.test.js. No MongoDB: Coupon and Book are mocked.
process.env.JWT_SECRET = 'test-secret';
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

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

const app = express();
app.use(express.json());
app.use('/api/coupons', couponRoutes);

const COUPON_ID = '64b7f0f2f2f2f2f2f2f2f2c1';
const BOOK_ID = '64b7f0f2f2f2f2f2f2f2f2f1';
const tokenFor = (role) => jwt.sign({ id: '64b7f0f2f2f2f2f2f2f2f2a1', role }, process.env.JWT_SECRET);
const asAdmin = () => ({ Authorization: `Bearer ${tokenFor('admin')}` });
const asStaff = () => ({ Authorization: `Bearer ${tokenFor('staff')}` });
const asCustomer = () => ({ Authorization: `Bearer ${tokenFor('customer')}` });

const validCoupon = { code: 'SAVE10', type: 'percentage', value: 10 };

beforeEach(() => {
  jest.resetAllMocks();
  Coupon.create.mockImplementation(async (data) => ({ _id: COUPON_ID, ...data }));
  Coupon.findByIdAndUpdate.mockImplementation(async (id, data) => ({ _id: id, ...data }));
  Book.findById.mockResolvedValue({ _id: BOOK_ID, title: 'Clean Code', price: 500, stock: 10 });
});

// =====================================================================
// Creating coupons: input rules
// =====================================================================
describe('POST /api/coupons - code rules', () => {
  test('a lower-case code is stored in upper case', async () => {
    const res = await request(app).post('/api/coupons').set(asAdmin()).send({ ...validCoupon, code: 'save10' });
    expect(res.status).toBe(201);
    expect(Coupon.create.mock.calls[0][0].code).toBe('SAVE10');
  });

  test('dashes and underscores are allowed in a code', async () => {
    const res = await request(app).post('/api/coupons').set(asAdmin()).send({ ...validCoupon, code: 'WEEK-END_5' });
    expect(res.status).toBe(201);
  });

  test('a 2-character code is rejected', async () => {
    const res = await request(app).post('/api/coupons').set(asAdmin()).send({ ...validCoupon, code: 'AB' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/3-20 letters/);
  });

  test('a 21-character code is rejected', async () => {
    const res = await request(app)
      .post('/api/coupons').set(asAdmin()).send({ ...validCoupon, code: 'A'.repeat(21) });
    expect(res.status).toBe(400);
  });

  test('a missing code is rejected', async () => {
    const res = await request(app).post('/api/coupons').set(asAdmin()).send({ type: 'fixed', value: 50 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Coupon code is required');
  });

  test('a duplicate code (MongoDB 11000) gives a clear 400, not a 500', async () => {
    Coupon.create.mockRejectedValue({ code: 11000 });
    const res = await request(app).post('/api/coupons').set(asAdmin()).send(validCoupon);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('A coupon with this code already exists');
  });
});

describe('POST /api/coupons - discount rules', () => {
  test('an unknown discount type is rejected', async () => {
    const res = await request(app).post('/api/coupons').set(asAdmin()).send({ ...validCoupon, type: 'bogus' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Discount type must be percentage or fixed');
  });

  test.each([['abc'], [0], [-5], [null]])('discount value %p is rejected', async (value) => {
    const res = await request(app).post('/api/coupons').set(asAdmin()).send({ ...validCoupon, value });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Discount value must be greater than 0');
  });

  test('a percentage of exactly 100 is allowed', async () => {
    const res = await request(app).post('/api/coupons').set(asAdmin()).send({ ...validCoupon, value: 100 });
    expect(res.status).toBe(201);
  });

  test('a percentage above 100 is rejected', async () => {
    const res = await request(app).post('/api/coupons').set(asAdmin()).send({ ...validCoupon, value: 100.5 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot be more than 100/);
  });

  test('a fixed amount above 100 is allowed (the 100 cap is percentage only)', async () => {
    const res = await request(app).post('/api/coupons').set(asAdmin())
      .send({ code: 'FLAT500', type: 'fixed', value: 500 });
    expect(res.status).toBe(201);
  });

  test('a maximum discount of 0 is rejected', async () => {
    const res = await request(app).post('/api/coupons').set(asAdmin()).send({ ...validCoupon, maxDiscount: 0 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Maximum discount must be greater than 0');
  });

  test('an empty maximum discount means no cap (stored as null)', async () => {
    const res = await request(app).post('/api/coupons').set(asAdmin()).send({ ...validCoupon, maxDiscount: '' });
    expect(res.status).toBe(201);
    expect(Coupon.create.mock.calls[0][0].maxDiscount).toBeNull();
  });

  test('a negative minimum purchase is rejected', async () => {
    const res = await request(app).post('/api/coupons').set(asAdmin()).send({ ...validCoupon, minPurchase: -1 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Minimum purchase cannot be negative');
  });

  test('a minimum purchase that is not a number is rejected', async () => {
    const res = await request(app).post('/api/coupons').set(asAdmin()).send({ ...validCoupon, minPurchase: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Numbers must be valid numbers');
  });

  test('a missing minimum purchase defaults to 0', async () => {
    await request(app).post('/api/coupons').set(asAdmin()).send(validCoupon);
    expect(Coupon.create.mock.calls[0][0].minPurchase).toBe(0);
  });
});

describe('POST /api/coupons - usage limit, dates and status', () => {
  test('a usage limit of 0 is allowed (coupon can never be used)', async () => {
    const res = await request(app).post('/api/coupons').set(asAdmin()).send({ ...validCoupon, usageLimit: 0 });
    expect(res.status).toBe(201);
    expect(Coupon.create.mock.calls[0][0].usageLimit).toBe(0);
  });

  test('a fractional usage limit is rejected', async () => {
    const res = await request(app).post('/api/coupons').set(asAdmin()).send({ ...validCoupon, usageLimit: 2.5 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Usage limit must be a whole number, 0 or more');
  });

  test('a negative usage limit is rejected', async () => {
    const res = await request(app).post('/api/coupons').set(asAdmin()).send({ ...validCoupon, usageLimit: -1 });
    expect(res.status).toBe(400);
  });

  test('an unreadable valid-from date is rejected', async () => {
    const res = await request(app).post('/api/coupons').set(asAdmin())
      .send({ ...validCoupon, validFrom: 'next tuesday-ish' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Dates must be valid');
  });

  test('a new coupon is active unless active:false is sent', async () => {
    await request(app).post('/api/coupons').set(asAdmin()).send(validCoupon);
    expect(Coupon.create.mock.calls[0][0].active).toBe(true);
  });

  test('active:false creates an inactive coupon', async () => {
    await request(app).post('/api/coupons').set(asAdmin()).send({ ...validCoupon, active: false });
    expect(Coupon.create.mock.calls[0][0].active).toBe(false);
  });

  test('the description is trimmed', async () => {
    await request(app).post('/api/coupons').set(asAdmin()).send({ ...validCoupon, description: '  Diwali  ' });
    expect(Coupon.create.mock.calls[0][0].description).toBe('Diwali');
  });

  test('an unexpected database error on create gives a generic 500', async () => {
    Coupon.create.mockRejectedValue(new Error('disk full'));
    const res = await request(app).post('/api/coupons').set(asAdmin()).send(validCoupon);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Server error' });
  });

  test('a customer cannot create a coupon (403) and nothing is saved', async () => {
    const res = await request(app).post('/api/coupons').set(asCustomer()).send(validCoupon);
    expect(res.status).toBe(403);
    expect(Coupon.create).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Listing and editing
// =====================================================================
describe('GET /api/coupons', () => {
  test('staff can list coupons, newest first', async () => {
    const sort = jest.fn().mockResolvedValue([{ code: 'A' }, { code: 'B' }]);
    Coupon.find.mockReturnValue({ sort });
    const res = await request(app).get('/api/coupons').set(asStaff());
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
  });

  test('a request with no token is refused (401)', async () => {
    const res = await request(app).get('/api/coupons');
    expect(res.status).toBe(401);
    expect(Coupon.find).not.toHaveBeenCalled();
  });
});

describe('PUT /api/coupons/:id', () => {
  test('an invalid id gives 400 and nothing is updated', async () => {
    const res = await request(app).put('/api/coupons/not-an-id').set(asAdmin()).send(validCoupon);
    expect(res.status).toBe(400);
    expect(Coupon.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('an unknown coupon gives 404', async () => {
    Coupon.findByIdAndUpdate.mockResolvedValue(null);
    const res = await request(app).put(`/api/coupons/${COUPON_ID}`).set(asAdmin()).send(validCoupon);
    expect(res.status).toBe(404);
  });

  test('invalid edits are rejected before the database is touched', async () => {
    const res = await request(app).put(`/api/coupons/${COUPON_ID}`).set(asAdmin())
      .send({ ...validCoupon, value: 150 });
    expect(res.status).toBe(400);
    expect(Coupon.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('the update runs validators and returns the new document', async () => {
    const res = await request(app).put(`/api/coupons/${COUPON_ID}`).set(asAdmin())
      .send({ ...validCoupon, value: 15, active: true });
    expect(res.status).toBe(200);
    expect(res.body.value).toBe(15);
    const options = Coupon.findByIdAndUpdate.mock.calls[0][2];
    expect(options).toEqual(expect.objectContaining({ new: true, runValidators: true }));
  });

  test('an edit never changes usedCount (the number of uses so far)', async () => {
    await request(app).put(`/api/coupons/${COUPON_ID}`).set(asAdmin())
      .send({ ...validCoupon, usedCount: 0 });
    const update = Coupon.findByIdAndUpdate.mock.calls[0][1];
    expect(update).not.toHaveProperty('usedCount');
  });

  // KNOWN DEFECT: buildCouponData sets active to true when the field is missing, so an edit that
  // leaves out "active" silently re-activates a deactivated coupon. Expected behaviour: keep the
  // current state. This test documents the defect; it will start failing once the defect is fixed,
  // at which point change test.failing to test.
  test.failing('KNOWN DEFECT: an edit without an "active" field does not re-activate a deactivated coupon', async () => {
    await request(app).put(`/api/coupons/${COUPON_ID}`).set(asAdmin()).send(validCoupon);
    const update = Coupon.findByIdAndUpdate.mock.calls[0][1];
    expect(update.active).toBeUndefined();
  });
});

describe('PATCH /api/coupons/:id/status', () => {
  test('an invalid id gives 400', async () => {
    const res = await request(app).patch('/api/coupons/bad/status').set(asAdmin()).send({ active: false });
    expect(res.status).toBe(400);
  });

  test('a missing or non-boolean active value is rejected', async () => {
    const res = await request(app).patch(`/api/coupons/${COUPON_ID}/status`).set(asAdmin())
      .send({ active: 'false' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('active must be true or false');
    expect(Coupon.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('deactivating sets only the active flag', async () => {
    const res = await request(app).patch(`/api/coupons/${COUPON_ID}/status`).set(asAdmin())
      .send({ active: false });
    expect(res.status).toBe(200);
    expect(Coupon.findByIdAndUpdate.mock.calls[0][1]).toEqual({ active: false });
  });

  test('an unknown coupon gives 404', async () => {
    Coupon.findByIdAndUpdate.mockResolvedValue(null);
    const res = await request(app).patch(`/api/coupons/${COUPON_ID}/status`).set(asAdmin())
      .send({ active: true });
    expect(res.status).toBe(404);
  });

  test('a customer cannot switch a coupon on or off (403)', async () => {
    const res = await request(app).patch(`/api/coupons/${COUPON_ID}/status`).set(asCustomer())
      .send({ active: false });
    expect(res.status).toBe(403);
    expect(Coupon.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Checkout preview: POST /api/coupons/validate (public, reserves nothing)
// =====================================================================
describe('POST /api/coupons/validate', () => {
  const cart = [{ bookId: BOOK_ID, quantity: 1 }];

  test('a code with spaces and lower case is found as upper case', async () => {
    Coupon.findOne.mockResolvedValue({ _id: COUPON_ID, code: 'SAVE10', type: 'percentage', value: 10, active: true, usedCount: 0, usageLimit: null, minPurchase: 0, maxDiscount: null, description: '' });
    await request(app).post('/api/coupons/validate').send({ items: cart, couponCode: '  save10 ' });
    expect(Coupon.findOne).toHaveBeenCalledWith({ code: 'SAVE10' });
  });

  test('returns the discount and total for a valid code', async () => {
    Coupon.findOne.mockResolvedValue({ _id: COUPON_ID, code: 'SAVE10', type: 'percentage', value: 10, active: true, usedCount: 0, usageLimit: null, minPurchase: 0, maxDiscount: null, description: 'Ten off' });
    const res = await request(app).post('/api/coupons/validate').send({ items: cart, couponCode: 'SAVE10' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ code: 'SAVE10', subtotal: 500, discount: 50, total: 450, description: 'Ten off' });
  });

  test('the preview never uses up a coupon use', async () => {
    Coupon.findOne.mockResolvedValue({ _id: COUPON_ID, code: 'SAVE10', type: 'percentage', value: 10, active: true, usedCount: 0, usageLimit: 5, minPurchase: 0, maxDiscount: null, description: '' });
    await request(app).post('/api/coupons/validate').send({ items: cart, couponCode: 'SAVE10' });
    expect(Coupon.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(Coupon.create).not.toHaveBeenCalled();
  });

  test('a cart below the minimum purchase explains the amount needed', async () => {
    Coupon.findOne.mockResolvedValue({ _id: COUPON_ID, code: 'BIG', type: 'fixed', value: 100, active: true, usedCount: 0, usageLimit: null, minPurchase: 1000, maxDiscount: null, description: '' });
    const res = await request(app).post('/api/coupons/validate').send({ items: cart, couponCode: 'BIG' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('A minimum purchase of ₹1000 is required for this coupon');
  });

  test('an empty cart is rejected', async () => {
    const res = await request(app).post('/api/coupons/validate').send({ items: [], couponCode: 'SAVE10' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Cart is empty');
  });

  test('a cart with a book that no longer exists is rejected', async () => {
    Book.findById.mockResolvedValue(null);
    const res = await request(app).post('/api/coupons/validate').send({ items: cart, couponCode: 'SAVE10' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('A book in your cart no longer exists');
  });

  test('a database failure gives a safe 500', async () => {
    Coupon.findOne.mockRejectedValue(new Error('socket hang up'));
    const res = await request(app).post('/api/coupons/validate').send({ items: cart, couponCode: 'SAVE10' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Server error' });
  });
});
