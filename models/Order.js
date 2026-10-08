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
  total: { type: Number, required: true },
  shippingAddress: {
    fullName: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    pincode: { type: String, required: true },
    phone: { type: String, required: true },
  },
  paymentStatus: { type: String, default: 'Paid' }, // fake payment -> always "Paid"
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Order', orderSchema);