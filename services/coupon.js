// services/coupon.js - coupon rules. No database calls here, so these rules are easy to test.

class CouponError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CouponError';
    this.status = 400;
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Coupon codes are case-insensitive, so store and compare them in upper case
function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

// Checks a coupon against the cart subtotal (already calculated from DATABASE prices).
// Returns { discount, total }, or throws CouponError with a message the customer can read.
function evaluateCoupon(coupon, subtotal, now = new Date()) {
  if (!coupon) throw new CouponError('Coupon code not found');
  if (!coupon.active) throw new CouponError('This coupon is not active');
  if (coupon.validFrom && now < new Date(coupon.validFrom)) {
    throw new CouponError('This coupon is not valid yet');
  }
  if (coupon.validUntil && now > new Date(coupon.validUntil)) {
    throw new CouponError('This coupon has expired');
  }
  if (coupon.usageLimit !== null && coupon.usageLimit !== undefined && coupon.usedCount >= coupon.usageLimit) {
    throw new CouponError('This coupon has reached its usage limit');
  }
  if (subtotal < (coupon.minPurchase || 0)) {
    throw new CouponError(`A minimum purchase of ₹${coupon.minPurchase} is required for this coupon`);
  }

  let discount;
  if (coupon.type === 'percentage') {
    discount = (subtotal * coupon.value) / 100;
    if (coupon.maxDiscount !== null && coupon.maxDiscount !== undefined) {
      discount = Math.min(discount, coupon.maxDiscount);
    }
  } else {
    discount = coupon.value;
  }
  discount = Math.min(round2(discount), subtotal); // a discount can never exceed the subtotal

  return { discount, total: round2(subtotal - discount) };
}

module.exports = { CouponError, normalizeCode, evaluateCoupon, round2 };
