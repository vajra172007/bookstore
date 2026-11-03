// models/Order.js - shape of an order document
const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [
    {
      book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
      title: String,      // copied at order time so history stays correct
      price: Number,      // price at the time of purchase
      quantity: Number,
    },
  ],
  subtotal: { type: Number, default: null },          // items before the discount
  couponCode: { type: String, default: null },         // coupon used, if any
  discountAmount: { type: Number, default: 0 },        // amount taken off by the coupon
  total: { type: Number, required: true },             // final amount paid
  shippingAddress: {
    fullName: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    pincode: { type: String, required: true },
    phone: { type: String, required: true },
  },
  paymentStatus: { type: String, default: 'Paid' }, // fake payment -> always "Paid"
  status: { type: String, enum: ['Placed', 'Cancelled', 'Refunded'], default: 'Placed' },
  stockRestored: { type: Boolean, default: false },   // true once the books went back to stock (never restore twice)
  stockRestoredAt: { type: Date, default: null },
  statusChangedAt: { type: Date, default: null },
  emailStatus: { type: String, default: null },        // sent | preview | failed | skipped (confirmation email)
  emailAttemptedAt: { type: Date, default: null },
  emailSentAt: { type: Date, default: null },          // set ONLY when the SMTP server accepted the message
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Order', orderSchema);