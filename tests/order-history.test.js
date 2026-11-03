// tests/order-history.test.js - Phase 3: customer order history and order details.
// MongoDB is NOT used: the models are mocks. The Order mock honours the "user" filter, so these
// tests check that a customer can only ever get their own orders.
process.env.JWT_SECRET = 'test-secret-for-order-history';

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

jest.mock('../models/Book', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() }));
jest.mock('../models/User', () => ({ findById: jest.fn() }));
jest.mock('../models/Order', () => ({
  create: jest.fn(), find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn(),
}));
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

const ALICE = '64b7f0f2f2f2f2f2f2f2f2a1';
const BOB = '64b7f0f2f2f2f2f2f2f2f2a2';
const ADMIN = '64b7f0f2f2f2f2f2f2f2f2a9';
const BOOK_1 = '64b7f0f2f2f2f2f2f2f2f2f1';
const ALICE_ORDER_1 = '64b7f0f2f2f2f2f2f2f2f2c1';
const ALICE_ORDER_2 = '64b7f0f2f2f2f2f2f2f2f2c2';
const BOB_ORDER = '64b7f0f2f2f2f2f2f2f2f2c3';
const MISSING_ORDER = '64b7f0f2f2f2f2f2f2f2f2ff';
const address = { fullName: 'Alice', address: '12 Main Street', city: 'Coimbatore', pincode: '641001', phone: '9876543210' };

const auth = (id, role = 'customer') => ({ Authorization: `Bearer ${jwt.sign({ id, role }, process.env.JWT_SECRET)}` });

const makeOrder = (id, user, overrides = {}) => ({
  _id: id,
  user,
  items: [
    { book: BOOK_1, title: 'Clean Code', price: 500, quantity: 2 },
    { book: '64b7f0f2f2f2f2f2f2f2f2f2', title: 'Refactoring', price: 300.5, quantity: 1 },
  ],
  subtotal: 1300.5,
  couponCode: 'SAVE10',
  discountAmount: 130.05,
  total: 1170.45,
  shippingAddress: address,
  paymentStatus: 'Paid',
  status: 'Placed',
  stockRestored: false,
  stockRestoredAt: null,
  statusChangedAt: null,
  createdAt: new Date('2026-10-01T10:00:00Z'),
  ...overrides,
});

let orders;

// The Order mock behaves like the database for the filters the routes use
function installFakeOrders() {
  Order.find.mockImplementation((filter) => {
    let rows = orders.filter((o) => String(o.user) === String(filter.user));
    const chain = {
      sort: (spec) => {
        if (spec && spec.createdAt === -1) rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
        return chain;
      },
      lean: async () => rows,
    };
    return chain;
  });
  Order.findOne.mockImplementation((filter) => ({
    lean: async () =>
      orders.find((o) => String(o._id) === String(filter._id) && String(o.user) === String(filter.user)) || null,
  }));
}

beforeEach(() => {
  jest.resetAllMocks();
  orders = [
    makeOrder(ALICE_ORDER_1, ALICE, { createdAt: new Date('2026-10-01T10:00:00Z') }),
    makeOrder(ALICE_ORDER_2, ALICE, { createdAt: new Date('2026-10-20T10:00:00Z'), status: 'Cancelled' }),
    makeOrder(BOB_ORDER, BOB, { items: [{ book: BOOK_1, title: 'Bobs Secret Book', price: 99, quantity: 1 }], total: 99 }),
  ];
  installFakeOrders();
});

// =====================================================================
describe('GET /api/orders/mine (order history)', () => {
  test('requires login', async () => {
    const res = await request(app).get('/api/orders/mine');
    expect(res.status).toBe(401);
    expect(Order.find).not.toHaveBeenCalled();
  });

  test('rejects a bad or tampered token', async () => {
    const forged = jwt.sign({ id: ALICE, role: 'customer' }, 'some-other-secret');
    const res = await request(app).get('/api/orders/mine').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(Order.find).not.toHaveBeenCalled();
  });

  test("lists only the logged-in customer's orders, newest first", async () => {
    const res = await request(app).get('/api/orders/mine').set(auth(ALICE));

    expect(res.status).toBe(200);
    expect(res.body.orders.map((o) => String(o.id))).toEqual([ALICE_ORDER_2, ALICE_ORDER_1]);
    expect(JSON.stringify(res.body)).not.toContain('Bobs Secret Book');
  });

  test('returns books, quantities, prices, discount, total and status', async () => {
    const res = await request(app).get('/api/orders/mine').set(auth(ALICE));
    const order = res.body.orders.find((o) => String(o.id) === ALICE_ORDER_1);

    expect(order).toMatchObject({
      status: 'Placed',
      subtotal: 1300.5,
      couponCode: 'SAVE10',
      discountAmount: 130.05,
      total: 1170.45,
    });
    expect(order.createdAt).toBeDefined();
    expect(order.items).toEqual([
      { bookId: BOOK_1, title: 'Clean Code', price: 500, quantity: 2, lineTotal: 1000 },
      { bookId: '64b7f0f2f2f2f2f2f2f2f2f2', title: 'Refactoring', price: 300.5, quantity: 1, lineTotal: 300.5 },
    ]);
    expect(res.body.orders.find((o) => String(o.id) === ALICE_ORDER_2).status).toBe('Cancelled');
  });

  test('does not expose internal fields', async () => {
    const res = await request(app).get('/api/orders/mine').set(auth(ALICE));
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('stockRestored');
    expect(text).not.toContain('statusChangedAt');
    expect(res.body.orders[0].user).toBeUndefined();
  });

  test('an order from before Phase 2/1 (no status, no subtotal) still displays', async () => {
    orders = [makeOrder(ALICE_ORDER_1, ALICE, { status: undefined, subtotal: null, couponCode: null, discountAmount: undefined, total: 1300.5 })];
    const res = await request(app).get('/api/orders/mine').set(auth(ALICE));

    expect(res.status).toBe(200);
    expect(res.body.orders[0]).toMatchObject({ status: 'Placed', subtotal: 1300.5, couponCode: null, discountAmount: 0 });
  });

  test('the customer comes from the token: a userId in the query is ignored', async () => {
    const res = await request(app).get(`/api/orders/mine?userId=${BOB}`).set(auth(ALICE));

    expect(res.status).toBe(200);
    expect(Order.find).toHaveBeenCalledWith({ user: ALICE });
    expect(JSON.stringify(res.body)).not.toContain('Bobs Secret Book');
  });

  test('an admin token gets only the admin\'s own orders, not everyone\'s', async () => {
    const res = await request(app).get('/api/orders/mine').set(auth(ADMIN, 'admin'));

    expect(Order.find).toHaveBeenCalledWith({ user: ADMIN });
    expect(res.status).toBe(200);
    expect(res.body.orders).toEqual([]);
  });

  test('a customer with no orders gets an empty list (not an error)', async () => {
    const res = await request(app).get('/api/orders/mine').set(auth('64b7f0f2f2f2f2f2f2f2f2b0'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orders: [] });
  });

  test('a token with a malformed user id is rejected', async () => {
    const res = await request(app).get('/api/orders/mine').set(auth('not-an-id'));
    expect(res.status).toBe(401);
    expect(Order.find).not.toHaveBeenCalled();
  });

  test('a database failure gives a safe 500', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    Order.find.mockImplementation(() => { throw new Error('db down'); });
    const res = await request(app).get('/api/orders/mine').set(auth(ALICE));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Server error' });
  });
});

// =====================================================================
describe('GET /api/orders/:id (order details)', () => {
  test('requires login', async () => {
    const res = await request(app).get(`/api/orders/${ALICE_ORDER_1}`);
    expect(res.status).toBe(401);
    expect(Order.findOne).not.toHaveBeenCalled();
  });

  test('the owner sees the full order', async () => {
    const res = await request(app).get(`/api/orders/${ALICE_ORDER_1}`).set(auth(ALICE));

    expect(res.status).toBe(200);
    expect(res.body.order).toMatchObject({
      id: ALICE_ORDER_1,
      status: 'Placed',
      subtotal: 1300.5,
      couponCode: 'SAVE10',
      discountAmount: 130.05,
      total: 1170.45,
      paymentStatus: 'Paid',
      shippingAddress: address,
    });
    expect(res.body.order.items).toHaveLength(2);
    expect(res.body.order.items[0]).toMatchObject({ title: 'Clean Code', quantity: 2, price: 500, lineTotal: 1000 });
  });

  test('the lookup is filtered by the id AND the token user', async () => {
    await request(app).get(`/api/orders/${ALICE_ORDER_1}`).set(auth(ALICE));
    expect(Order.findOne).toHaveBeenCalledWith({ _id: ALICE_ORDER_1, user: ALICE });
  });

  test("another customer's order is not found, and nothing about it leaks", async () => {
    const res = await request(app).get(`/api/orders/${BOB_ORDER}`).set(auth(ALICE));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Order not found' });
    expect(JSON.stringify(res.body)).not.toContain('Bobs Secret Book');
  });

  test.each(['admin', 'staff'])("a %s cannot read a customer's order through the customer endpoint", async (role) => {
    const res = await request(app).get(`/api/orders/${ALICE_ORDER_1}`).set(auth(ADMIN, role));

    expect(res.status).toBe(404);
    expect(res.body.order).toBeUndefined();
  });

  test('a token cannot be pointed at someone else through a query or header', async () => {
    const res = await request(app).get(`/api/orders/${BOB_ORDER}?userId=${BOB}`).set(auth(ALICE)).set('X-User-Id', BOB);
    expect(res.status).toBe(404);
  });

  test.each(['abc', '123', 'undefined', '64b7f0f2f2f2f2f2f2f2f2zz', '%7B%24ne%3Anull%7D'])(
    'invalid order id "%s" gives 400',
    async (badId) => {
      const res = await request(app).get(`/api/orders/${badId}`).set(auth(ALICE));
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'Invalid order id' });
      expect(Order.findOne).not.toHaveBeenCalled();
    }
  );

  test('a valid but nonexistent order id gives 404', async () => {
    const res = await request(app).get(`/api/orders/${MISSING_ORDER}`).set(auth(ALICE));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'Order not found' });
  });

  test('"mine" is not mistaken for an order id', async () => {
    const res = await request(app).get('/api/orders/mine').set(auth(ALICE));
    expect(res.status).toBe(200);
    expect(Order.findOne).not.toHaveBeenCalled();
  });

  test('a cancelled order shows its status', async () => {
    const res = await request(app).get(`/api/orders/${ALICE_ORDER_2}`).set(auth(ALICE));
    expect(res.body.order.status).toBe('Cancelled');
  });

  test('a database failure gives a safe 500', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    Order.findOne.mockImplementation(() => { throw new Error('db down'); });
    const res = await request(app).get(`/api/orders/${ALICE_ORDER_1}`).set(auth(ALICE));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Server error' });
  });
});

// =====================================================================
describe('POST /api/orders takes the customer from the token', () => {
  const book = () => ({ _id: BOOK_1, title: 'Clean Code', price: 500, stock: 10 });
  const items = [{ bookId: BOOK_1, quantity: 2 }];

  beforeEach(() => {
    User.findById.mockResolvedValue({ _id: ALICE });
    installFakeBooks(Book, [book()]);
    Order.create.mockImplementation(async (data) => ({ _id: ALICE_ORDER_1, ...data }));
  });

  test('requires login', async () => {
    const res = await request(app).post('/api/orders').send({ items, shippingAddress: address });
    expect(res.status).toBe(401);
    expect(Order.create).not.toHaveBeenCalled();
  });

  test('the order is saved for the token user even when no userId is sent', async () => {
    const res = await request(app).post('/api/orders').set(auth(ALICE)).send({ items, shippingAddress: address });

    expect(res.status).toBe(201);
    expect(User.findById).toHaveBeenCalledWith(ALICE);
    expect(Order.create.mock.calls[0][0].user).toBe(ALICE);
  });

  test("a userId for someone else in the body is rejected and nothing is bought", async () => {
    const res = await request(app).post('/api/orders').set(auth(ALICE)).send({ userId: BOB, items, shippingAddress: address });

    expect(res.status).toBe(403);
    expect(Order.create).not.toHaveBeenCalled();
    expect(Book.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('a matching userId in the body is accepted (older front end)', async () => {
    const res = await request(app).post('/api/orders').set(auth(ALICE)).send({ userId: ALICE, items, shippingAddress: address });
    expect(res.status).toBe(201);
  });
});

// =====================================================================
describe('existing coupon, inventory and admin rules still work', () => {
  beforeEach(() => {
    User.findById.mockResolvedValue({ _id: ALICE });
    Order.create.mockImplementation(async (data) => ({ _id: ALICE_ORDER_1, ...data }));
  });

  test('a coupon order takes stock atomically and stores the discount the history will show', async () => {
    const b = { _id: BOOK_1, title: 'Clean Code', price: 500, stock: 10 };
    installFakeBooks(Book, [b]);
    Coupon.findOne.mockResolvedValue({
      _id: 'c1', code: 'SAVE10', type: 'percentage', value: 10, minPurchase: 0, maxDiscount: null,
      validFrom: null, validUntil: null, usageLimit: null, usedCount: 0, active: true,
    });
    Coupon.findOneAndUpdate.mockResolvedValue({ usedCount: 1 });

    const res = await request(app).post('/api/orders').set(auth(ALICE))
      .send({ items: [{ bookId: BOOK_1, quantity: 2 }], shippingAddress: address, couponCode: 'save10' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ subtotal: 1000, discount: 100, total: 900 });
    expect(b.stock).toBe(8);
    expect(Order.create.mock.calls[0][0]).toMatchObject({ couponCode: 'SAVE10', discountAmount: 100, total: 900 });
  });

  test('out-of-stock is still rejected, with no order and no stock change', async () => {
    const b = { _id: BOOK_1, title: 'Clean Code', price: 500, stock: 1 };
    installFakeBooks(Book, [b]);

    const res = await request(app).post('/api/orders').set(auth(ALICE))
      .send({ items: [{ bookId: BOOK_1, quantity: 2 }], shippingAddress: address });

    expect(res.status).toBe(400);
    expect(Order.create).not.toHaveBeenCalled();
    expect(b.stock).toBe(1);
  });

  test('a customer still cannot cancel/refund, and an admin still restores stock once', async () => {
    const b = { _id: BOOK_1, title: 'Clean Code', price: 500, stock: 5 };
    installFakeBooks(Book, [b]);
    Order.findOneAndUpdate.mockResolvedValue({
      _id: ALICE_ORDER_1, user: ALICE, status: 'Cancelled', stockRestored: true,
      items: [{ book: BOOK_1, title: 'Clean Code', price: 500, quantity: 2 }],
    });

    const denied = await request(app).patch(`/api/orders/${ALICE_ORDER_1}/status`).set(auth(ALICE)).send({ status: 'Cancelled' });
    expect(denied.status).toBe(403);
    expect(b.stock).toBe(5);

    const ok = await request(app).patch(`/api/orders/${ALICE_ORDER_1}/status`).set(auth(ADMIN, 'admin')).send({ status: 'Cancelled' });
    expect(ok.status).toBe(200);
    expect(b.stock).toBe(7);
  });
});
