// tests/services.test.js - unit tests for services/pricing.js, services/inventory.js and the
// coupon rules in services/coupon.js. Book is mocked; no MongoDB is used.
jest.mock('../models/Book', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() }));

const Book = require('../models/Book');
const { priceCart } = require('../services/pricing');
const { reserveStock, addStock, StockError } = require('../services/inventory');
const { evaluateCoupon, normalizeCode, round2, CouponError } = require('../services/coupon');

const BOOK_1 = '64b7f0f2f2f2f2f2f2f2f2f1';
const BOOK_2 = '64b7f0f2f2f2f2f2f2f2f2f2';

beforeEach(() => {
  jest.resetAllMocks();
});

// =====================================================================
// pricing.priceCart
// =====================================================================
describe('priceCart - cart shape', () => {
  test('rejects an empty cart', async () => {
    await expect(priceCart([])).rejects.toMatchObject({ message: 'Cart is empty', status: 400 });
  });

  test('rejects a cart that is not a list', async () => {
    await expect(priceCart(undefined)).rejects.toMatchObject({ message: 'Cart is empty' });
  });

  test('rejects a line with no book id', async () => {
    await expect(priceCart([{ quantity: 1 }])).rejects.toMatchObject({ message: 'Invalid item in cart' });
    expect(Book.findById).not.toHaveBeenCalled();
  });

  test.each([[0], [-1], ['abc'], [1.5], [NaN]])('quantity %p is an invalid item', async (quantity) => {
    await expect(priceCart([{ bookId: BOOK_1, quantity }])).rejects.toMatchObject({ message: 'Invalid item in cart' });
  });

  test('a quantity sent as text ("3") counts as 3', async () => {
    Book.findById.mockResolvedValue({ _id: BOOK_1, title: 'X', price: 100, stock: 10 });
    const { lines, subtotal } = await priceCart([{ bookId: BOOK_1, quantity: '3' }]);
    expect(lines[0].quantity).toBe(3);
    expect(subtotal).toBe(300);
  });

  test('a book that no longer exists is reported', async () => {
    Book.findById.mockResolvedValue(null);
    await expect(priceCart([{ bookId: BOOK_1, quantity: 1 }])).rejects.toMatchObject({
      message: 'A book in your cart no longer exists',
    });
  });

  test('asking for more copies than are in stock gives the count that is left', async () => {
    Book.findById.mockResolvedValue({ _id: BOOK_1, title: 'Clean Code', price: 100, stock: 2 });
    await expect(priceCart([{ bookId: BOOK_1, quantity: 3 }])).rejects.toMatchObject({
      message: 'Only 2 copies of "Clean Code" are in stock',
    });
  });
});

describe('priceCart - totals', () => {
  test('subtotal is the sum of price x quantity over all lines, rounded to 2 decimals', async () => {
    Book.findById.mockImplementation(async (id) =>
      id === BOOK_1
        ? { _id: BOOK_1, title: 'A', price: 19.99, stock: 10 }
        : { _id: BOOK_2, title: 'B', price: 5, stock: 10 });
    const { subtotal } = await priceCart([
      { bookId: BOOK_1, quantity: 3 },   // 59.97
      { bookId: BOOK_2, quantity: 2 },   // 10
    ]);
    expect(subtotal).toBe(69.97);
  });

  test('returns each line with the database book and the quantity', async () => {
    const book = { _id: BOOK_1, title: 'A', price: 10, stock: 10 };
    Book.findById.mockResolvedValue(book);
    const { lines } = await priceCart([{ bookId: BOOK_1, quantity: 2 }]);
    expect(lines).toEqual([{ book, quantity: 2 }]);
  });

  test('the same book on two lines is priced twice, not merged', async () => {
    Book.findById.mockResolvedValue({ _id: BOOK_1, title: 'A', price: 10, stock: 10 });
    const { lines, subtotal } = await priceCart([
      { bookId: BOOK_1, quantity: 1 },
      { bookId: BOOK_1, quantity: 2 },
    ]);
    expect(lines).toHaveLength(2);
    expect(subtotal).toBe(30);
  });

  test('a price sent in the item is ignored; the database price is used', async () => {
    Book.findById.mockResolvedValue({ _id: BOOK_1, title: 'A', price: 100, stock: 10 });
    const { subtotal } = await priceCart([{ bookId: BOOK_1, quantity: 1, price: 1 }]);
    expect(subtotal).toBe(100);
  });
});

// =====================================================================
// inventory.reserveStock / addStock
// =====================================================================
describe('reserveStock', () => {
  test('an empty list takes nothing and touches no book', async () => {
    const taken = await reserveStock([]);
    expect(taken).toEqual([]);
    expect(Book.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('each line is one conditional update: only while stock >= quantity', async () => {
    Book.findOneAndUpdate.mockResolvedValue({ stock: 3 });
    const taken = await reserveStock([{ book: { _id: BOOK_1, title: 'A' }, quantity: 2 }]);
    expect(Book.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: BOOK_1, stock: { $gte: 2 } },
      { $inc: { stock: -2 } },
      { new: true }
    );
    expect(taken).toEqual([{ bookId: BOOK_1, quantity: 2 }]);
  });

  test('a book with 0 left gives "is out of stock"', async () => {
    Book.findOneAndUpdate.mockResolvedValue(null);
    Book.findById.mockResolvedValue({ _id: BOOK_1, title: 'A', stock: 0 });
    const err = await reserveStock([{ book: { _id: BOOK_1, title: 'A' }, quantity: 1 }]).catch((e) => e);
    expect(err).toBeInstanceOf(StockError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('"A" is out of stock');
  });

  test('exactly 1 copy left uses the singular wording', async () => {
    Book.findOneAndUpdate.mockResolvedValue(null);
    Book.findById.mockResolvedValue({ _id: BOOK_1, title: 'A', stock: 1 });
    const err = await reserveStock([{ book: { _id: BOOK_1, title: 'A' }, quantity: 2 }]).catch((e) => e);
    expect(err.message).toBe('Only 1 copy of "A" are in stock');
  });

  test('a book deleted between the check and the take counts as out of stock', async () => {
    Book.findOneAndUpdate.mockResolvedValue(null);
    Book.findById.mockResolvedValue(null);
    const err = await reserveStock([{ book: { _id: BOOK_1, title: 'A' }, quantity: 1 }]).catch((e) => e);
    expect(err.message).toBe('"A" is out of stock');
  });

  test('when a later line fails, the earlier lines are put back by their quantity', async () => {
    Book.findOneAndUpdate
      .mockResolvedValueOnce({ stock: 0 })   // line 1 taken
      .mockResolvedValueOnce(null);          // line 2 fails
    Book.findById.mockResolvedValue({ _id: BOOK_2, title: 'B', stock: 0 });
    Book.updateOne.mockResolvedValue({});

    await expect(reserveStock([
      { book: { _id: BOOK_1, title: 'A' }, quantity: 4 },
      { book: { _id: BOOK_2, title: 'B' }, quantity: 1 },
    ])).rejects.toBeInstanceOf(StockError);

    expect(Book.updateOne).toHaveBeenCalledTimes(1);
    expect(Book.updateOne).toHaveBeenCalledWith({ _id: BOOK_1 }, { $inc: { stock: 4 } });
  });
});

describe('addStock', () => {
  test('an empty list changes nothing', async () => {
    await addStock([]);
    expect(Book.updateOne).not.toHaveBeenCalled();
  });

  test('adds each quantity back with one update per book', async () => {
    Book.updateOne.mockResolvedValue({});
    await addStock([{ bookId: BOOK_1, quantity: 2 }, { bookId: BOOK_2, quantity: 5 }]);
    expect(Book.updateOne.mock.calls).toEqual([
      [{ _id: BOOK_1 }, { $inc: { stock: 2 } }],
      [{ _id: BOOK_2 }, { $inc: { stock: 5 } }],
    ]);
  });

  test('if one update fails, the ones already done are undone and the error is thrown', async () => {
    Book.updateOne
      .mockResolvedValueOnce({})                       // first book: added
      .mockRejectedValueOnce(new Error('timeout'))     // second book: fails
      .mockResolvedValueOnce({});                      // undo of the first book
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(addStock([{ bookId: BOOK_1, quantity: 2 }, { bookId: BOOK_2, quantity: 1 }]))
      .rejects.toThrow('timeout');

    expect(Book.updateOne).toHaveBeenCalledTimes(3);
    expect(Book.updateOne.mock.calls[2]).toEqual([{ _id: BOOK_1 }, { $inc: { stock: -2 } }]);
  });
});

// =====================================================================
// coupon rules (pure)
// =====================================================================
describe('coupon rules - edge cases', () => {
  const base = { code: 'C', type: 'percentage', value: 10, active: true, minPurchase: 0, maxDiscount: null, validFrom: null, validUntil: null, usageLimit: null, usedCount: 0 };

  test('a coupon with no usage limit (undefined) is never used up', () => {
    const coupon = { ...base, usageLimit: undefined, usedCount: 99999 };
    expect(evaluateCoupon(coupon, 100).discount).toBe(10);
  });

  test('a percentage discount with a fraction is rounded to 2 decimals', () => {
    const { discount, total } = evaluateCoupon({ ...base, value: 33.33 }, 100);
    expect(discount).toBe(33.33);
    expect(total).toBe(66.67);
  });

  test('a cap larger than the discount has no effect', () => {
    const { discount } = evaluateCoupon({ ...base, maxDiscount: 1000 }, 200);
    expect(discount).toBe(20);
  });

  test('a coupon whose validity ends exactly now is still valid', () => {
    const t = new Date('2026-11-05T12:00:00Z');
    const coupon = { ...base, validUntil: t };
    expect(evaluateCoupon(coupon, 100, t).discount).toBe(10);
  });

  test('a coupon that starts exactly now is valid', () => {
    const t = new Date('2026-11-05T12:00:00Z');
    const coupon = { ...base, validFrom: t };
    expect(evaluateCoupon(coupon, 100, t).discount).toBe(10);
  });

  test('a cart total of 0 with a fixed coupon gives total 0 and discount 0', () => {
    const { discount, total } = evaluateCoupon({ ...base, type: 'fixed', value: 50 }, 0);
    expect(discount).toBe(0);
    expect(total).toBe(0);
  });

  test('an inactive coupon error is a CouponError the customer can read', () => {
    expect(() => evaluateCoupon({ ...base, active: false }, 100)).toThrow(CouponError);
    expect(() => evaluateCoupon({ ...base, active: false }, 100)).toThrow('This coupon is not active');
  });

  test('round2 rounds to the nearest paisa and leaves whole numbers alone', () => {
    expect(round2(2.346)).toBe(2.35);
    expect(round2(2.341)).toBe(2.34);
    expect(round2(10)).toBe(10);
  });

  test('normalizeCode handles null and undefined', () => {
    expect(normalizeCode(null)).toBe('');
    expect(normalizeCode(undefined)).toBe('');
  });
});
