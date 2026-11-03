// routes/orders.js - create an order after the (fake) payment
const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Order = require('../models/Order');
const Coupon = require('../models/Coupon');
const { priceCart } = require('../services/pricing');
const { reserveStock, addStock } = require('../services/inventory');
const { requireAuth, requireRole } = require('../auth');
const { sendOrderConfirmation } = require('../services/email');
const { CouponError, evaluateCoupon, normalizeCode } = require('../services/coupon');

const router = express.Router();

// ---------- Customer order history helpers ----------
const round2 = (n) => Math.round(Number(n) * 100) / 100;

// The customer-facing shape of an order. Internal fields (stockRestored, etc.) are never sent.
function toOrderView(order) {
  const items = (order.items || []).map((i) => ({
    bookId: i.book,
    title: i.title,
    price: i.price,
    quantity: i.quantity,
    lineTotal: round2(i.price * i.quantity),
  }));
  const itemsTotal = round2(items.reduce((sum, i) => sum + i.lineTotal, 0));
  return {
    id: order._id,
    createdAt: order.createdAt,
    status: order.status || 'Placed',              // orders from before Phase 2 have no status
    items,
    subtotal: order.subtotal === null || order.subtotal === undefined ? itemsTotal : order.subtotal,
    couponCode: order.couponCode || null,
    discountAmount: order.discountAmount || 0,
    total: order.total,
    paymentStatus: order.paymentStatus,
    shippingAddress: order.shippingAddress,
  };
}

// GET /api/orders/mine - the logged-in customer's own orders, newest first.
// The customer comes ONLY from the verified token. There is no way to ask for someone else's orders,
// and admin/staff tokens get their own orders here too (not everybody's).
router.get('/mine', requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.user.id)) {
      return res.status(401).json({ message: 'Session expired. Please login again' });
    }
    const orders = await Order.find({ user: req.user.id }).sort({ createdAt: -1 }).lean();
    res.json({ orders: orders.map(toOrderView) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/orders/:id - one of the logged-in customer's own orders.
// The lookup filters by BOTH the order id and the token's user id, so another customer's order
// (or any order, for an admin/staff token) is simply "not found". This does not reveal that it exists.
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid order id' });
    }
    if (!mongoose.isValidObjectId(req.user.id)) {
      return res.status(401).json({ message: 'Session expired. Please login again' });
    }
    const order = await Order.findOne({ _id: id, user: req.user.id }).lean();
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.json({ order: toOrderView(order) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/orders   (login required)
// The customer is taken from the verified JWT. A userId in the body is not needed; if one is sent
// and it is not the logged-in user, the request is rejected.
// Body: {
//   items: [{ bookId: "...", quantity: 2 }],
//   shippingAddress: { fullName, address, city, pincode, phone },
//   couponCode: "SAVE10"            (optional)
// }
// Prices, discounts and totals are ALL calculated here. Any price or discount sent by the browser is ignored.
router.post('/', requireAuth, async (req, res) => {
  let couponReserved = false;
  let coupon = null;
  let stockTaken = [];

  try {
    const { items, shippingAddress, couponCode } = req.body;
    const userId = req.user.id;   // from the verified token, never from the body

    // 1. Validate the request
    if (req.body.userId !== undefined && String(req.body.userId) !== String(userId)) {
      return res.status(403).json({ message: 'You can only place orders for your own account' });
    }
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(401).json({ message: 'Session expired. Please login again' });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({ message: 'User not found. Please login again' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }
    const a = shippingAddress || {};
    if (!a.fullName || !a.address || !a.city || !a.pincode || !a.phone) {
      return res.status(400).json({ message: 'Complete shipping address is required' });
    }

    // 2. Price the cart from database prices and check stock
    const { lines, subtotal } = await priceCart(items);

    // 3. Apply the coupon, if one was entered
    let discount = 0;
    let total = subtotal;
    const code = normalizeCode(couponCode);
    if (code) {
      coupon = await Coupon.findOne({ code });
      const priced = evaluateCoupon(coupon, subtotal);
      discount = priced.discount;
      total = priced.total;

      // 4. Use up one coupon use. The update only succeeds while the limit has not been reached,
      //    so two checkouts cannot both take the last use.
      const reserved = await Coupon.findOneAndUpdate(
        {
          _id: coupon._id,
          active: true,
          $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }],
        },
        { $inc: { usedCount: 1 } },
        { new: true }
      );
      if (!reserved) {
        throw new CouponError('This coupon has reached its usage limit');
      }
      couponReserved = true;
    }

    // 5. Take the stock atomically. Each book is updated only if enough copies are still left,
    //    so two checkouts cannot oversell. If any book fails, earlier ones are put back.
    stockTaken = await reserveStock(lines);

    // 6. Create the order (payment is FAKE, so it is always marked "Paid")
    const order = await Order.create({
      user: user._id,
      items: lines.map((line) => ({
        book: line.book._id,
        title: line.book.title,   // copied at order time so history stays correct
        price: line.book.price,   // price at the time of purchase
        quantity: line.quantity,
      })),
      subtotal,
      couponCode: coupon ? coupon.code : null,
      discountAmount: discount,
      total,
      shippingAddress: {
        fullName: a.fullName,
        address: a.address,
        city: a.city,
        pincode: a.pincode,
        phone: a.phone,
      },
      paymentStatus: 'Paid',
    });

    // 7. Confirmation email. The order is already saved, so an email problem can never undo it.
    //    sendOrderConfirmation never throws; emailStatus tells the truth about what happened.
    let emailStatus = 'skipped';
    try {
      const mail = await sendOrderConfirmation(order, user);
      emailStatus = mail.status;
      await Order.updateOne(
        { _id: order._id },
        { $set: { emailStatus: mail.status, emailAttemptedAt: new Date(), emailSentAt: mail.status === 'sent' ? new Date() : null } }
      );
    } catch (emailErr) {
      console.error('Could not record email status');
    }

    res.status(201).json({
      message: 'Order placed successfully',
      orderId: order._id,
      subtotal,
      discount,
      total: order.total,
      emailStatus,   // sent | preview | failed | skipped
    });
  } catch (err) {
    // Give the stock back if it was taken but the order was not created
    if (stockTaken.length > 0) {
      try {
        await addStock(stockTaken);
      } catch (restoreErr) {
        console.error('Could not give back stock:', restoreErr);
      }
    }
    // Give the coupon use back if the order was not created
    if (couponReserved) {
      try {
        await Coupon.updateOne({ _id: coupon._id }, { $inc: { usedCount: -1 } });
      } catch (releaseErr) {
        console.error('Could not give back coupon use:', releaseErr);
      }
    }
    if (err.status === 400) {
      return res.status(400).json({ message: err.message });
    }
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/orders/:id/status - admin or staff cancels or refunds an order.
// Body: { status: "Cancelled" | "Refunded" }
// Stock goes back exactly once: the order is "claimed" with ONE conditional update
// (stockRestored must still be false), so a double click or two admins cannot restore twice.
router.patch('/:id/status', requireAuth, requireRole('admin', 'staff'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid order id' });
    }
    if (status !== 'Cancelled' && status !== 'Refunded') {
      return res.status(400).json({ message: 'Status must be Cancelled or Refunded' });
    }

    // Claim the order: only a Placed order whose stock has not been restored can match
    const claimed = await Order.findOneAndUpdate(
      { _id: id, status: { $in: ['Placed', null] }, stockRestored: { $ne: true } },
      { $set: { status, stockRestored: true, stockRestoredAt: new Date(), statusChangedAt: new Date() } },
      { new: true }
    );

    if (!claimed) {
      const existing = await Order.findById(id);
      if (!existing) {
        return res.status(404).json({ message: 'Order not found' });
      }
      // A cancelled order can still be marked refunded; its stock is already back, so nothing is restored
      if (existing.status === 'Cancelled' && status === 'Refunded') {
        const refunded = await Order.findOneAndUpdate(
          { _id: id, status: 'Cancelled' },
          { $set: { status: 'Refunded', statusChangedAt: new Date() } },
          { new: true }
        );
        if (refunded) {
          return res.json({ message: 'Order marked as refunded. Stock was already restored', order: refunded });
        }
      }
      return res.status(400).json({ message: `This order is already ${existing.status.toLowerCase()}` });
    }

    // We own the restoration now. If it fails, undo the claim so it can be retried.
    try {
      await addStock(claimed.items.map((i) => ({ bookId: i.book, quantity: i.quantity })));
    } catch (restoreErr) {
      await Order.updateOne(
        { _id: id },
        { $set: { status: 'Placed', stockRestored: false, stockRestoredAt: null, statusChangedAt: null } }
      );
      throw restoreErr;
    }

    res.json({ message: `Order ${status.toLowerCase()} and stock restored`, order: claimed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
