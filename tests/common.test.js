/**
 * @jest-environment jsdom
 */
// tests/common.test.js
// Unit tests for the cart business logic in public/js/common.js
// (addToCart, getCart, saveCart, cartTotal).
// The line above makes Jest run this file in a fake browser (jsdom),
// so localStorage exists. No server or database is used.

const fs = require('fs');
const path = require('path');

// ---------- 1. Load common.js ----------
// common.js is a plain browser script (it has no module.exports), so we cannot
// require() it. Instead we read the file and run its code, then pick out the
// functions we want to test. common.js itself is NOT modified.
const code = fs.readFileSync(path.join(__dirname, '../public/js/common.js'), 'utf8');
const { addToCart, getCart, saveCart, cartTotal } = new Function(
  code + '\n; return { addToCart, getCart, saveCart, cartTotal };'
)();

// ---------- 2. Test data and helpers ----------
// Creates a fake book as it would come from the API. Pass overrides to change fields.
function makeBook(overrides) {
  return {
    _id: 'book-1',
    title: 'Clean Code',
    price: 500,
    image: 'clean-code.jpg',
    stock: 5,
    ...overrides,
  };
}

// Every test starts with an empty localStorage (empty cart)
beforeEach(() => {
  localStorage.clear();
});

// =====================================================================
// NORMAL CASES
// =====================================================================
describe('cart - normal cases', () => {
  test('adds a new book to the cart with quantity 1', () => {
    const result = addToCart(makeBook());

    expect(result.ok).toBe(true);
    expect(result.message).toBe('"Clean Code" added to cart');
    expect(getCart()).toEqual([
      {
        bookId: 'book-1',
        title: 'Clean Code',
        price: 500,
        image: 'clean-code.jpg',
        stock: 5,
        quantity: 1,
      },
    ]);
  });

  test('adding the same book again increases its quantity (no duplicate line)', () => {
    addToCart(makeBook());
    addToCart(makeBook());

    const cart = getCart();
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(2);
  });

  test('calculates the cart total as the sum of price x quantity', () => {
    const cart = [
      { bookId: 'a', price: 500, quantity: 2 },   // 1000
      { bookId: 'b', price: 300, quantity: 1 },   //  300
    ];

    expect(cartTotal(cart)).toBe(1300);
  });

  test('saves the cart and loads the same data back', () => {
    const cart = [{ bookId: 'a', title: 'Book A', price: 100, stock: 3, quantity: 2 }];

    saveCart(cart);

    expect(getCart()).toEqual(cart);
  });
});

// =====================================================================
// EDGE CASES
// =====================================================================
describe('cart - edge cases', () => {
  test('an empty cart has a total of 0', () => {
    expect(cartTotal([])).toBe(0);
    expect(cartTotal(getCart())).toBe(0);   // nothing saved yet -> empty cart
  });

  test('allows adding copies up to exactly the available stock', () => {
    const book = makeBook({ stock: 2 });

    const first = addToCart(book);
    const second = addToCart(book);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(getCart()[0].quantity).toBe(2);
  });

  test('refuses to add more copies than the available stock', () => {
    const book = makeBook({ stock: 2 });
    addToCart(book);
    addToCart(book);

    const third = addToCart(book);   // 3rd copy, but only 2 in stock

    expect(third.ok).toBe(false);
    expect(third.message).toBe('Only 2 copies available. You already have 2 in your cart');
    expect(getCart()[0].quantity).toBe(2);   // quantity did not change
  });

  test('updates the stored stock value when the same book is added again', () => {
    addToCart(makeBook({ stock: 5 }));
    expect(getCart()[0].stock).toBe(5);

    addToCart(makeBook({ stock: 8 }));       // stock changed in the database

    expect(getCart()[0].stock).toBe(8);
  });
});

// =====================================================================
// INVALID / ERROR CASES
// =====================================================================
describe('cart - invalid and error cases', () => {
  test('refuses a book that has 0 stock', () => {
    const result = addToCart(makeBook({ stock: 0 }));

    expect(result.ok).toBe(false);
    expect(result.message).toBe('This book is out of stock');
    expect(getCart()).toEqual([]);           // nothing was added
  });

  test('returns an empty cart when the saved cart JSON is corrupted', () => {
    localStorage.setItem('cart', '{this is not valid json');

    expect(getCart()).toEqual([]);
  });
});