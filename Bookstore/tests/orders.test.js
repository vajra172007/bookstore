// tests/orders.test.js
// Unit tests for the business logic in routes/orders.js  (POST /api/orders)
// MongoDB is NOT used. The Book, User and Order models are replaced with mocks.

const request = require('supertest');
const express = require('express');

// ---------- 1. Mock the models (so no database is needed) ----------
jest.mock('../models/Book', () => ({ findById: jest.fn() }));
jest.mock('../models/User', () => ({ findById: jest.fn() }));
jest.mock('../models/Order', () => ({ create: jest.fn() }));

const Book = require('../models/Book');
const User = require('../models/User');
const Order = require('../models/Order');
const ordersRouter = require('../routes/orders');

// ---------- 2. Tiny Express app that only mounts the orders router ----------
const app = express();
app.use(express.json());
app.use('/api/orders', ordersRouter);

// ---------- 3. Test data and helpers ----------
const USER_ID = '64b7f0f2f2f2f2f2f2f2f2a1';   // valid 24-character ids
const BOOK_ID_1 = '64b7f0f2f2f2f2f2f2f2f2f1';
const BOOK_ID_2 = '64b7f0f2f2f2f2f2f2f2f2f2';

const validAddress = {
  fullName: 'Vajra',
  address: '12 Main Street',
  city: 'Coimbatore',
  pincode: '641001',
  phone: '9876543210',
};

// Creates a fake book. Pass overrides to change any field.
function makeBook(overrides) {
  return {
    _id: BOOK_ID_1,
    title: 'Clean Code',
    price: 500,
    stock: 10,
    save: jest.fn().mockResolvedValue(),   // the route calls book.save()
    ...overrides,
  };
}

// Tells the fake Book.findById which books exist in the "database"
function mockBooksInDatabase(...books) {
  Book.findById.mockImplementation(async (id) => {
    return books.find((b) => b._id === id) || null;
  });
}

// Sends POST /api/orders
function postOrder(body) {
  return request(app).post('/api/orders').send(body);
}

beforeEach(() => {
  jest.resetAllMocks();

  // The user always exists
  User.findById.mockResolvedValue({ _id: USER_ID });

  // Order.create returns the order data it received, plus an _id
  Order.create.mockImplementation(async (data) => ({ _id: 'order-123', ...data }));
});

// =====================================================================
// NORMAL CASES
// =====================================================================
describe('POST /api/orders - normal cases', () => {
  test('creates a valid single-item order', async () => {
    mockBooksInDatabase(makeBook({ price: 500, stock: 10 }));

    const res = await postOrder({
      userId: USER_ID,
      items: [{ bookId: BOOK_ID_1, quantity: 2 }],
      shippingAddress: validAddress,
    });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Order placed successfully');
    expect(res.body.orderId).toBe('order-123');
    expect(res.body.total).toBe(1000);
    expect(Order.create).toHaveBeenCalledTimes(1);
  });

  test('creates a valid multi-item order with all items saved', async () => {
    mockBooksInDatabase(
      makeBook({ _id: BOOK_ID_1, title: 'Clean Code', price: 500 }),
      makeBook({ _id: BOOK_ID_2, title: 'The Hobbit', price: 300 })
    );

    const res = await postOrder({
      userId: USER_ID,
      items: [
        { bookId: BOOK_ID_1, quantity: 1 },
        { bookId: BOOK_ID_2, quantity: 2 },
      ],
      shippingAddress: validAddress,
    });

    expect(res.status).toBe(201);

    const savedOrder = Order.create.mock.calls[0][0];
    expect(savedOrder.items).toHaveLength(2);
    expect(savedOrder.items[0].title).toBe('Clean Code');
    expect(savedOrder.items[1].title).toBe('The Hobbit');
    expect(savedOrder.items[1].quantity).toBe(2);
  });

  test('calculates the total from database prices (ignores any price sent by the client)', async () => {
    mockBooksInDatabase(
      makeBook({ _id: BOOK_ID_1, price: 500 }),
      makeBook({ _id: BOOK_ID_2, price: 300 })
    );

    const res = await postOrder({
      userId: USER_ID,
      items: [
        { bookId: BOOK_ID_1, quantity: 2, price: 1 },  // fake price, should be ignored
        { bookId: BOOK_ID_2, quantity: 1 },
      ],
      shippingAddress: validAddress,
    });

    // 500 x 2 + 300 x 1 = 1300
    expect(res.status).toBe(201);
    expect(res.body.total).toBe(1300);
    expect(Order.create.mock.calls[0][0].total).toBe(1300);
  });

  test('reduces the stock of the ordered book', async () => {
    const book = makeBook({ stock: 10 });
    mockBooksInDatabase(book);

    await postOrder({
      userId: USER_ID,
      items: [{ bookId: BOOK_ID_1, quantity: 3 }],
      shippingAddress: validAddress,
    });

    expect(book.stock).toBe(7);                    // 10 - 3 Fixed the value
    expect(book.save).toHaveBeenCalledTimes(1);
  });

  test('marks the order paymentStatus as "Paid"', async () => {
    mockBooksInDatabase(makeBook());

    await postOrder({
      userId: USER_ID,
      items: [{ bookId: BOOK_ID_1, quantity: 1 }],
      shippingAddress: validAddress,
    });

    expect(Order.create.mock.calls[0][0].paymentStatus).toBe('Paid');
  });
});

// =====================================================================
// EDGE CASES
// =====================================================================
describe('POST /api/orders - edge cases', () => {
  test('allows ordering exactly the available stock (stock becomes 0)', async () => {
    const book = makeBook({ stock: 4 });
    mockBooksInDatabase(book);

    const res = await postOrder({
      userId: USER_ID,
      items: [{ bookId: BOOK_ID_1, quantity: 4 }],
      shippingAddress: validAddress,
    });

    expect(res.status).toBe(201);
    expect(book.stock).toBe(0);
  });

  test('rounds the total of a decimal price to 2 decimals', async () => {
    mockBooksInDatabase(makeBook({ price: 199.99, stock: 10 }));

    const res = await postOrder({
      userId: USER_ID,
      items: [{ bookId: BOOK_ID_1, quantity: 3 }],
      shippingAddress: validAddress,
    });

    // 199.99 x 3 = 599.97
    expect(res.status).toBe(201);
    expect(res.body.total).toBe(599.97);
  });
});

// =====================================================================
// INVALID / ERROR CASES
// =====================================================================
describe('POST /api/orders - invalid and error cases', () => {
  test('rejects a request with missing items', async () => {
    const res = await postOrder({
      userId: USER_ID,
      shippingAddress: validAddress,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Cart is empty');
    expect(Order.create).not.toHaveBeenCalled();
  });

  test('rejects an empty items array', async () => {
    const res = await postOrder({
      userId: USER_ID,
      items: [],
      shippingAddress: validAddress,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Cart is empty');
    expect(Order.create).not.toHaveBeenCalled();
  });

  test('rejects an invalid book ID', async () => {
    const res = await postOrder({
      userId: USER_ID,
      items: [{ bookId: 'not-a-valid-id', quantity: 1 }],
      shippingAddress: validAddress,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid item in cart');
    expect(Book.findById).not.toHaveBeenCalled();
    expect(Order.create).not.toHaveBeenCalled();
  });

  test('rejects a book that does not exist', async () => {
    mockBooksInDatabase();   // empty database

    const res = await postOrder({
      userId: USER_ID,
      items: [{ bookId: BOOK_ID_1, quantity: 1 }],
      shippingAddress: validAddress,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('A book in your cart no longer exists');
    expect(Order.create).not.toHaveBeenCalled();
  });

  test('rejects quantity 0', async () => {
    const book = makeBook({ stock: 10 });
    mockBooksInDatabase(book);

    const res = await postOrder({
      userId: USER_ID,
      items: [{ bookId: BOOK_ID_1, quantity: 0 }],
      shippingAddress: validAddress,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid item in cart');
    expect(Order.create).not.toHaveBeenCalled();
    expect(book.stock).toBe(10);   // stock unchanged
  });

  test('rejects a negative quantity', async () => {
    const book = makeBook({ stock: 10 });
    mockBooksInDatabase(book);

    const res = await postOrder({
      userId: USER_ID,
      items: [{ bookId: BOOK_ID_1, quantity: -2 }],
      shippingAddress: validAddress,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid item in cart');
    expect(Order.create).not.toHaveBeenCalled();
    expect(book.stock).toBe(10);   // stock unchanged
  });

  test('rejects a quantity greater than the available stock', async () => {
    const book = makeBook({ title: 'Clean Code', stock: 5 });
    mockBooksInDatabase(book);

    const res = await postOrder({
      userId: USER_ID,
      items: [{ bookId: BOOK_ID_1, quantity: 6 }],
      shippingAddress: validAddress,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Only 5 copies of "Clean Code" are in stock');
    expect(Order.create).not.toHaveBeenCalled();
    expect(book.stock).toBe(5);    // stock unchanged
  });

  test('rejects an order with a missing shipping address field', async () => {
    mockBooksInDatabase(makeBook());

    const addressWithoutCity = { ...validAddress };
    delete addressWithoutCity.city;

    const res = await postOrder({
      userId: USER_ID,
      items: [{ bookId: BOOK_ID_1, quantity: 1 }],
      shippingAddress: addressWithoutCity,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Complete shipping address is required');
    expect(Order.create).not.toHaveBeenCalled();
  });
});