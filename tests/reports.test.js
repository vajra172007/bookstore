// tests/reports.test.js - GET /api/reports/sales and GET /api/reports/inventory
// No MongoDB: the Order and Book models are mocked. Aggregation pipelines are checked
// by their shape, and the numbers come from the mocked aggregation results.
process.env.JWT_SECRET = 'test-secret';
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

jest.mock('../models/Order', () => ({ aggregate: jest.fn() }));
jest.mock('../models/Book', () => ({ aggregate: jest.fn(), find: jest.fn() }));

const Order = require('../models/Order');
const Book = require('../models/Book');
const reportRoutes = require('../routes/reports');

const app = express();
app.use(express.json());
app.use('/api/reports', reportRoutes);

const tokenFor = (role) => jwt.sign({ id: '64b7f0f2f2f2f2f2f2f2f2a1', role }, process.env.JWT_SECRET);
const asAdmin = () => ({ Authorization: `Bearer ${tokenFor('admin')}` });
const asCustomer = () => ({ Authorization: `Bearer ${tokenFor('customer')}` });

// Fake for Book.find(...).select(...).sort(...).limit(...).lean()
function findChain(rows) {
  const chain = {
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn(async () => rows),
  };
  return chain;
}

beforeEach(() => {
  jest.resetAllMocks();
  Order.aggregate.mockResolvedValue([]);
  Book.aggregate.mockResolvedValue([]);
  Book.find.mockImplementation(() => findChain([]));
});

// =====================================================================
// Access control (applies to the whole router)
// =====================================================================
describe('reports - access control', () => {
  test('sales report requires login (401)', async () => {
    const res = await request(app).get('/api/reports/sales');
    expect(res.status).toBe(401);
  });

  test('inventory report requires login (401)', async () => {
    const res = await request(app).get('/api/reports/inventory');
    expect(res.status).toBe(401);
  });

  test('a customer cannot read the sales report (403)', async () => {
    const res = await request(app).get('/api/reports/sales').set(asCustomer());
    expect(res.status).toBe(403);
    expect(Order.aggregate).not.toHaveBeenCalled();
  });

  test('a customer cannot read the inventory report (403)', async () => {
    const res = await request(app).get('/api/reports/inventory').set(asCustomer());
    expect(res.status).toBe(403);
    expect(Book.aggregate).not.toHaveBeenCalled();
  });

  test('staff can read both reports', async () => {
    const staff = { Authorization: `Bearer ${tokenFor('staff')}` };
    expect((await request(app).get('/api/reports/sales').set(staff)).status).toBe(200);
    expect((await request(app).get('/api/reports/inventory').set(staff)).status).toBe(200);
  });
});

// =====================================================================
// Sales report
// =====================================================================
describe('GET /api/reports/sales - figures', () => {
  test('revenue, order counts and books sold come from Placed orders; cancelled/refunded are counted separately', async () => {
    Order.aggregate
      .mockResolvedValueOnce([
        { _id: 'Placed', orders: 3, revenue: 2500.5, units: 7 },
        { _id: 'Cancelled', orders: 1, revenue: 900, units: 2 },
        { _id: 'Refunded', orders: 2, revenue: 300, units: 1 },
      ])
      .mockResolvedValueOnce([]);

    const res = await request(app).get('/api/reports/sales').set(asAdmin());

    expect(res.status).toBe(200);
    expect(res.body.revenue).toBe(2500.5);
    expect(res.body.totalOrders).toBe(6);
    expect(res.body.completedOrders).toBe(3);
    expect(res.body.cancelledOrders).toBe(1);
    expect(res.body.refundedOrders).toBe(2);
    expect(res.body.booksSold).toBe(7);
  });

  test('revenue is rounded to 2 decimal places', async () => {
    Order.aggregate
      .mockResolvedValueOnce([{ _id: 'Placed', orders: 1, revenue: 1234.567, units: 1 }])
      .mockResolvedValueOnce([]);
    const res = await request(app).get('/api/reports/sales').set(asAdmin());
    expect(res.body.revenue).toBe(1234.57);
  });

  test('returns zeros and an empty best-seller list when there are no orders', async () => {
    const res = await request(app).get('/api/reports/sales').set(asAdmin());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      revenue: 0, totalOrders: 0, completedOrders: 0, cancelledOrders: 0,
      refundedOrders: 0, booksSold: 0, bestSellers: [],
    });
  });

  test('best sellers are mapped from the top-sellers aggregation', async () => {
    Order.aggregate
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { _id: 'b1', title: 'Clean Code', quantitySold: 5, revenue: 2500.004 },
      ]);
    const res = await request(app).get('/api/reports/sales').set(asAdmin());
    expect(res.body.bestSellers).toEqual([
      { bookId: 'b1', title: 'Clean Code', quantitySold: 5, revenue: 2500 },
    ]);
  });

  test('the best-seller pipeline only counts Placed orders (and old orders with no status)', async () => {
    await request(app).get('/api/reports/sales').set(asAdmin());
    const topPipeline = Order.aggregate.mock.calls[1][0];
    const statusMatch = topPipeline.find((stage) => stage.$match && stage.$match.$or);
    expect(statusMatch).toBeDefined();
    expect(statusMatch.$match.$or).toEqual(
      expect.arrayContaining([{ status: 'Placed' }, { status: null }, { status: { $exists: false } }])
    );
  });

  test('status counts treat a missing status as Placed', async () => {
    await request(app).get('/api/reports/sales').set(asAdmin());
    const statusPipeline = Order.aggregate.mock.calls[0][0];
    expect(JSON.stringify(statusPipeline)).toContain('"Placed"');
    expect(JSON.stringify(statusPipeline)).toContain('$ifNull');
  });
});

describe('GET /api/reports/sales - date range', () => {
  test('no dates means no createdAt filter', async () => {
    await request(app).get('/api/reports/sales').set(asAdmin());
    expect(Order.aggregate.mock.calls[0][0][0]).toEqual({ $match: {} });
  });

  test('a YYYY-MM-DD "from" is the start of that day (UTC)', async () => {
    const res = await request(app).get('/api/reports/sales?from=2026-01-01').set(asAdmin());
    const range = Order.aggregate.mock.calls[0][0][0].$match.createdAt;
    expect(range.$gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(res.body.range.from).toBe('2026-01-01T00:00:00.000Z');
  });

  test('a YYYY-MM-DD "to" includes the whole of that day (UTC)', async () => {
    await request(app).get('/api/reports/sales?to=2026-01-31').set(asAdmin());
    const range = Order.aggregate.mock.calls[0][0][0].$match.createdAt;
    expect(range.$lte.toISOString()).toBe('2026-01-31T23:59:59.999Z');
  });

  test('a full ISO date-time is used exactly as sent', async () => {
    await request(app)
      .get('/api/reports/sales?from=2026-03-01T04:30:00.000Z')
      .set(asAdmin());
    const range = Order.aggregate.mock.calls[0][0][0].$match.createdAt;
    expect(range.$gte.toISOString()).toBe('2026-03-01T04:30:00.000Z');
  });

  test('"from" after "to" is rejected with 400', async () => {
    const res = await request(app)
      .get('/api/reports/sales?from=2026-02-10&to=2026-02-01')
      .set(asAdmin());
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/must not be after/);
    expect(Order.aggregate).not.toHaveBeenCalled();
  });

  test('an unreadable date is rejected with 400', async () => {
    const res = await request(app).get('/api/reports/sales?from=not-a-date').set(asAdmin());
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Dates must be valid');
  });

  test('an empty "from" value is treated as no filter', async () => {
    await request(app).get('/api/reports/sales?from=').set(asAdmin());
    expect(Order.aggregate.mock.calls[0][0][0]).toEqual({ $match: {} });
  });
});

describe('GET /api/reports/sales - limit', () => {
  test('defaults to 10 best sellers', async () => {
    await request(app).get('/api/reports/sales').set(asAdmin());
    const limitStage = Order.aggregate.mock.calls[1][0].find((s) => s.$limit !== undefined);
    expect(limitStage.$limit).toBe(10);
  });

  test.each([['0'], ['51'], ['abc'], ['2.5']])('limit=%s is rejected with 400', async (value) => {
    const res = await request(app).get(`/api/reports/sales?limit=${value}`).set(asAdmin());
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/limit must be a whole number from 1 to 50/);
  });

  test.each([['1'], ['50']])('limit=%s (the boundaries) is accepted', async (value) => {
    const res = await request(app).get(`/api/reports/sales?limit=${value}`).set(asAdmin());
    expect(res.status).toBe(200);
    const limitStage = Order.aggregate.mock.calls[1][0].find((s) => s.$limit !== undefined);
    expect(limitStage.$limit).toBe(Number(value));
  });
});

describe('GET /api/reports/sales - failures', () => {
  test('a database failure gives a safe 500 with no internals', async () => {
    Order.aggregate.mockRejectedValue(new Error('connection refused at 10.0.0.5'));
    const res = await request(app).get('/api/reports/sales').set(asAdmin());
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Server error' });
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
  });
});

// =====================================================================
// Inventory report
// =====================================================================
describe('GET /api/reports/inventory', () => {
  test('defaults the low-stock threshold to 5', async () => {
    const res = await request(app).get('/api/reports/inventory').set(asAdmin());
    expect(res.body.threshold).toBe(5);
  });

  test.each([['0'], ['1001'], ['abc'], ['1.5']])('threshold=%s is rejected with 400', async (value) => {
    const res = await request(app).get(`/api/reports/inventory?threshold=${value}`).set(asAdmin());
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/threshold must be a whole number from 1 to 1000/);
  });

  test('totals come from the aggregation, with stock value rounded to 2 decimals', async () => {
    Book.aggregate.mockResolvedValue([
      { titles: 12, units: 150, value: 45000.456, outOfStock: 2, lowStock: 3 },
    ]);
    const res = await request(app).get('/api/reports/inventory').set(asAdmin());
    expect(res.body).toMatchObject({
      totalTitles: 12,
      totalUnits: 150,
      inventoryValue: 45000.46,
      outOfStockCount: 2,
      lowStockCount: 3,
    });
  });

  test('an empty catalogue gives zeros, not an error', async () => {
    const res = await request(app).get('/api/reports/inventory').set(asAdmin());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalTitles: 0, totalUnits: 0, inventoryValue: 0, lowStockCount: 0, outOfStockCount: 0,
      lowStockBooks: [], outOfStockBooks: [],
    });
  });

  test('low-stock books are listed; the query is stock from 1 up to the threshold', async () => {
    const lowBook = { title: 'Low One', stock: 2 };
    const low = findChain([lowBook]);
    Book.find.mockImplementationOnce(() => low).mockImplementationOnce(() => findChain([]));

    const res = await request(app).get('/api/reports/inventory?threshold=7').set(asAdmin());

    expect(res.body.lowStockBooks).toEqual([lowBook]);
    expect(low.lean).toHaveBeenCalled();
  });

  test('the low-stock filter uses 0 < stock <= threshold', async () => {
    await request(app).get('/api/reports/inventory?threshold=7').set(asAdmin());
    expect(Book.find.mock.calls[0][0]).toEqual({ stock: { $gt: 0, $lte: 7 } });
  });

  test('the out-of-stock filter uses stock <= 0', async () => {
    await request(app).get('/api/reports/inventory').set(asAdmin());
    expect(Book.find.mock.calls[1][0]).toEqual({ stock: { $lte: 0 } });
  });

  test('out-of-stock books are listed separately', async () => {
    const outBook = { title: 'Gone', stock: 0 };
    Book.find.mockImplementationOnce(() => findChain([])).mockImplementationOnce(() => findChain([outBook]));
    const res = await request(app).get('/api/reports/inventory').set(asAdmin());
    expect(res.body.outOfStockBooks).toEqual([outBook]);
  });

  test('the book lists are capped at 200 and the cap is reported', async () => {
    const res = await request(app).get('/api/reports/inventory').set(asAdmin());
    expect(res.body.listsCappedAt).toBe(200);
  });

  test('a database failure gives a safe 500', async () => {
    Book.aggregate.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/reports/inventory').set(asAdmin());
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Server error' });
  });
});
