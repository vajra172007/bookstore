// models/Coupon.js - a discount code customers can enter at checkout
const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: '' },
    type: { type: String, enum: ['percentage', 'fixed'], required: true },
    value: { type: Number, required: true, min: 0 },        // percent (0-100) or rupee amount
    minPurchase: { type: Number, default: 0, min: 0 },      // subtotal needed before the coupon applies
    maxDiscount: { type: Number, default: null, min: 0 },   // cap for percentage coupons (null = no cap)
    validFrom: { type: Date, default: null },
    validUntil: { type: Date, default: null },
    usageLimit: { type: Number, default: null, min: 0 },    // total uses allowed (null = unlimited)
    usedCount: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Coupon', couponSchema);
