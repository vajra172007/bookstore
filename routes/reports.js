// routes/reports.js - sales and inventory reports (admin/staff only), computed from MongoDB
const express = require('express');
const Order = require('../models/Order');
const Book = require('../models/Book');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'staff'));

class ReportError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function handleError(res, err) {
  if (err.status === 400) return res.status(400).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: 'Server error' });
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Reads optional from/to query values (ISO date-time, or YYYY-MM-DD = whole day in UTC).
function parseRange(query) {
  const range = {};
  const read = (value, isEnd) => {
    if (value === undefined || value === '') return null;
    const text = String(value);
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
    const d = new Date(dateOnly ? text + (isEnd ? 'T23:59:59.999Z' : 'T00:00:00.000Z') : text);
    if (Number.isNaN(d.getTime())) throw new ReportError('Dates must be valid');
    return d;
  };
  const from = read(query.from, false);
  const to = read(query.to, true);
  if (from && to && from > to) throw new ReportError('"From" date must not be after "To" date');
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return { range, from, to };
}

// GET /api/reports/sales?from=&to=&limit=
// "Actual sales" = orders whose status is Placed (or missing on old orders).
// Cancelled and Refunded orders are counted separately and are NOT in revenue or books sold.
router.get('/sales', async (req, res) => {
  try {
    const { range, from, to } = parseRange(req.query);
    let limit = 10;
    if (req.query.limit !== undefined) {
      limit = Number(req.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new ReportError('limit must be a whole number from 1 to 50');
      }
    }

    const match = Object.keys(range).length ? { createdAt: range } : {};

    const [statusRows, topRows] = await Promise.all([
      Order.aggregate([
        { $match: match },
        { $addFields: { st: { $ifNull: ['$status', 'Placed'] }, units: { $sum: '$items.quantity' } } },
        { $group: { _id: '$st', orders: { $sum: 1 }, revenue: { $sum: '$total' }, units: { $sum: '$units' } } },
      ]),
      Order.aggregate([
        { $match: match },
        { $match: { $or: [{ status: 'Placed' }, { status: null }, { status: { $exists: false } }] } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.book',
            title: { $first: '$items.title' },
            quantitySold: { $sum: '$items.quantity' },
            revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          },
        },
        { $sort: { quantitySold: -1, title: 1 } },
        { $limit: limit },
      ]),
    ]);

    const by = {};
    statusRows.forEach((r) => (by[r._id] = r));
    const get = (s, f) => (by[s] ? by[s][f] : 0);
    const totalOrders = statusRows.reduce((sum, r) => sum + r.orders, 0);

    res.json({
      range: { from: from ? from.toISOString() : null, to: to ? to.toISOString() : null },
      revenue: round2(get('Placed', 'revenue')),
      totalOrders,
      completedOrders: get('Placed', 'orders'),
      cancelledOrders: get('Cancelled', 'orders'),
      refundedOrders: get('Refunded', 'orders'),
      booksSold: get('Placed', 'units'),
      bestSellers: topRows.map((r) => ({
        bookId: r._id,
        title: r.title,
        quantitySold: r.quantitySold,
        revenue: round2(r.revenue),
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/reports/inventory?threshold=5
// Low stock = stock from 1 up to threshold. Out of stock = 0.
router.get('/inventory', async (req, res) => {
  try {
    let threshold = 5;
    if (req.query.threshold !== undefined) {
      threshold = Number(req.query.threshold);
      if (!Number.isInteger(threshold) || threshold < 1 || threshold > 1000) {
        throw new ReportError('threshold must be a whole number from 1 to 1000');
      }
    }
    const LIST_CAP = 200;
    const fields = 'title author isbn category price stock';

    const [totals, low, out] = await Promise.all([
      Book.aggregate([
        {
          $group: {
            _id: null,
            titles: { $sum: 1 },
            units: { $sum: '$stock' },
            value: { $sum: { $multiply: ['$price', '$stock'] } },
            outOfStock: { $sum: { $cond: [{ $lte: ['$stock', 0] }, 1, 0] } },
            lowStock: {
              $sum: { $cond: [{ $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', threshold] }] }, 1, 0] },
            },
          },
        },
      ]),
      Book.find({ stock: { $gt: 0, $lte: threshold } }).select(fields).sort({ stock: 1, title: 1 }).limit(LIST_CAP).lean(),
      Book.find({ stock: { $lte: 0 } }).select(fields).sort({ title: 1 }).limit(LIST_CAP).lean(),
    ]);

    const t = totals[0] || { titles: 0, units: 0, value: 0, outOfStock: 0, lowStock: 0 };
    res.json({
      threshold,
      totalTitles: t.titles,
      totalUnits: t.units,
      inventoryValue: round2(t.value),
      lowStockCount: t.lowStock,
      outOfStockCount: t.outOfStock,
      lowStockBooks: low,
      outOfStockBooks: out,
      listsCappedAt: LIST_CAP,
    });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
