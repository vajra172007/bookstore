// services/inventory.js - atomic stock changes.
// Every change is ONE MongoDB update, so two checkouts can never both take the last copy.
const Book = require('../models/Book');

class StockError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StockError';
    this.status = 400;
  }
}

// Gives stock back for [{ bookId, quantity }]. Used for rollbacks and for cancelled/refunded orders.
// All or nothing: if one update fails, the ones already done are undone before the error is thrown,
// so a retry can never add the same copies twice.
async function addStock(entries) {
  const done = [];
  try {
    for (const { bookId, quantity } of entries) {
      await Book.updateOne({ _id: bookId }, { $inc: { stock: quantity } });
      done.push({ bookId, quantity });
    }
  } catch (err) {
    for (const { bookId, quantity } of done) {
      try {
        await Book.updateOne({ _id: bookId }, { $inc: { stock: -quantity } });
      } catch (undoErr) {
        console.error('Could not undo partial stock restore:', undoErr);
      }
    }
    throw err;
  }
}

// Takes stock for every line, or for none of them.
// lines: [{ book, quantity }]. Each update only matches while stock >= quantity.
async function reserveStock(lines) {
  const taken = [];
  try {
    for (const line of lines) {
      const updated = await Book.findOneAndUpdate(
        { _id: line.book._id, stock: { $gte: line.quantity } },
        { $inc: { stock: -line.quantity } },
        { new: true }
      );
      if (!updated) {
        // Someone else bought the copies after the cart was checked
        const current = await Book.findById(line.book._id);
        const left = current ? current.stock : 0;
        throw new StockError(
          left < 1
            ? `"${line.book.title}" is out of stock`
            : `Only ${left} ${left === 1 ? 'copy' : 'copies'} of "${line.book.title}" are in stock`
        );
      }
      taken.push({ bookId: line.book._id, quantity: line.quantity });
    }
  } catch (err) {
    // Put back whatever was already taken for the earlier lines
    try {
      await addStock(taken);
    } catch (rollbackErr) {
      console.error('Could not roll back stock:', rollbackErr);
    }
    throw err;
  }
  return taken;
}

module.exports = { reserveStock, addStock, StockError };
