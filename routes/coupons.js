// routes/coupons.js - coupon preview for checkout (public) and coupon management (admin/staff)
const express = require('express');
const mongoose = require('mongoose');
const Coupon = require('../models/Coupon');
const { requireAuth, requireRole } = require('../auth');
const { priceCart } = require('../services/pricing');
const { CouponError, evaluateCoupon, normalizeCode } = require('../services/coupon');

const router = express.Router();
const adminOnly = [requireAuth, requireRole('admin', 'staff')];

// Sends the right status code for validation errors, and a generic 500 for anything else
function handleError(res, err) {
  if (err.status === 400) return res.status(400).json({ message: err.message });
  if (err.code === 11000) return res.status(400).json({ message: 'A coupon with this code already exists' });
  console.error(err);
  return res.status(500).json({ message: 'Server error' });
}

// Turns "" / undefined / null into null, otherwise into a number
function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new CouponError('Numbers must be valid numbers');
  return n;
}

function optionalDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new CouponError('Dates must be valid');
  return d;
}

// Checks and cleans the coupon fields an admin sends. Throws CouponError with a clear message.
function buildCouponData(body) {
  const code = normalizeCode(body.code);
  if (!code) throw new CouponError('Coupon code is required');
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) {
    throw new CouponError('Code must be 3-20 letters, numbers, dashes or underscores');
  }
  if (!['percentage', 'fixed'].includes(body.type)) {
    throw new CouponError('Discount type must be percentage or fixed');
  }

  const value = Number(body.value);
  if (!Number.isFinite(value) || value <= 0) {
    throw new CouponError('Discount value must be greater than 0');
  }
  if (body.type === 'percentage' && value > 100) {
    throw new CouponError('A percentage discount cannot be more than 100');
  }

  const minPurchase = optionalNumber(body.minPurchase) ?? 0;
  if (minPurchase < 0) throw new CouponError('Minimum purchase cannot be negative');

  const maxDiscount = optionalNumber(body.maxDiscount);
  if (maxDiscount !== null && maxDiscount <= 0) {
    throw new CouponError('Maximum discount must be greater than 0');
  }

  const usageLimit = optionalNumber(body.usageLimit);
  if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 0)) {
    throw new CouponError('Usage limit must be a whole number, 0 or more');
  }

  const validFrom = optionalDate(body.validFrom);
  const validUntil = optionalDate(body.validUntil);
  if (validFrom && validUntil && validFrom > validUntil) {
    throw new CouponError('"Valid from" must be before "valid until"');
  }

  return {
    code,
    description: String(body.description || '').trim(),
    type: body.type,
    value,
    minPurchase,
    maxDiscount,
    validFrom,
    validUntil,
    usageLimit,
    active: body.active !== false,
  };
}

// POST /api/coupons/validate - checkout preview. Body: { items: [{bookId, quantity}], couponCode }
// Calculates the discount on the server. Does NOT use up a coupon; the order does that.
router.post('/validate', async (req, res) => {
  try {
    const code = normalizeCode(req.body.couponCode);
    if (!code) {
      return res.status(400).json({ message: 'Please enter a coupon code' });
    }

    const { subtotal } = await priceCart(req.body.items);
    const coupon = await Coupon.findOne({ code });
    const { discount, total } = evaluateCoupon(coupon, subtotal);

    res.json({
      code: coupon.code,
      description: coupon.description,
      type: coupon.type,
      value: coupon.value,
      subtotal,
      discount,
      total,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/coupons - all coupons (admin/staff)
router.get('/', ...adminOnly, async (req, res) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    res.json(coupons);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/coupons - create a coupon (admin/staff)
router.post('/', ...adminOnly, async (req, res) => {
  try {
    const coupon = await Coupon.create(buildCouponData(req.body));
    res.status(201).json(coupon);
  } catch (err) {
    handleError(res, err);
  }
});

// PUT /api/coupons/:id - edit a coupon (admin/staff). usedCount is never changed here.
router.put('/:id', ...adminOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid coupon id' });
    }
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, buildCouponData(req.body), {
      new: true,
      runValidators: true,
    });
    if (!coupon) return res.status(404).json({ message: 'Coupon not found' });
    res.json(coupon);
  } catch (err) {
    handleError(res, err);
  }
});

// PATCH /api/coupons/:id/status - activate or deactivate. Body: { active: true|false }
router.patch('/:id/status', ...adminOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid coupon id' });
    }
    if (typeof req.body.active !== 'boolean') {
      return res.status(400).json({ message: 'active must be true or false' });
    }
    const coupon = await Coupon.findByIdAndUpdate(
      req.params.id,
      { active: req.body.active },
      { new: true }
    );
    if (!coupon) return res.status(404).json({ message: 'Coupon not found' });
    res.json(coupon);
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
