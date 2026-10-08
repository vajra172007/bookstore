// tests/auth.test.js
// Unit tests for the business logic in routes/auth.js
// (POST /api/register and POST /api/login)
// MongoDB is NOT used. The User model and bcryptjs are replaced with mocks.

const request = require('supertest');
const express = require('express');

// ---------- 1. Mock the User model and bcryptjs ----------
jest.mock('../models/User', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('bcryptjs', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

const bcrypt = require('bcryptjs');
const User = require('../models/User');
const authRouter = require('../routes/auth');

// ---------- 2. Tiny Express app that only mounts the auth router ----------
const app = express();
app.use(express.json());
app.use('/api', authRouter);

// ---------- 3. Test data and helpers ----------
const validRegistration = {
  name: 'Vajra',
  email: 'vajra@test.com',
  password: 'secret123',
};

// A fake user as it would come back from the database
const savedUser = {
  _id: 'user-1',
  name: 'Vajra',
  email: 'vajra@test.com',
  password: 'hashed-password',
};

function postRegister(body) {
  return request(app).post('/api/register').send(body);
}

function postLogin(body) {
  return request(app).post('/api/login').send(body);
}

beforeEach(() => {
  jest.resetAllMocks();
});

// =====================================================================
// REGISTER - NORMAL CASES
// =====================================================================
describe('POST /api/register - normal cases', () => {
  test('registers a new user successfully', async () => {
    User.findOne.mockResolvedValue(null);              // email not used yet
    bcrypt.hash.mockResolvedValue('hashed-password');
    User.create.mockResolvedValue(savedUser);

    const res = await postRegister(validRegistration);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Registration successful');
    expect(res.body.user).toEqual({
      id: 'user-1',
      name: 'Vajra',
      email: 'vajra@test.com',
    });
    expect(res.body.user.password).toBeUndefined();    // password is never returned
  });

  test('hashes the password before saving the user', async () => {
    User.findOne.mockResolvedValue(null);
    bcrypt.hash.mockResolvedValue('hashed-password');
    User.create.mockResolvedValue(savedUser);

    await postRegister(validRegistration);

    expect(bcrypt.hash).toHaveBeenCalledWith('secret123', 10);

    // The user is saved with the HASH, not the plain password
    const dataSaved = User.create.mock.calls[0][0];
    expect(dataSaved.password).toBe('hashed-password');
    expect(dataSaved.password).not.toBe('secret123');
  });
});

// =====================================================================
// REGISTER - EDGE CASES
// =====================================================================
describe('POST /api/register - edge cases', () => {
  test('normalizes the email (lowercase + trimmed) when checking for duplicates', async () => {
    User.findOne.mockResolvedValue(null);
    bcrypt.hash.mockResolvedValue('hashed-password');
    User.create.mockResolvedValue(savedUser);

    await postRegister({ ...validRegistration, email: '  Vajra@Test.COM  ' });

    expect(User.findOne).toHaveBeenCalledWith({ email: 'vajra@test.com' });
  });

  test('accepts a password of exactly 6 characters', async () => {
    User.findOne.mockResolvedValue(null);
    bcrypt.hash.mockResolvedValue('hashed-password');
    User.create.mockResolvedValue(savedUser);

    const res = await postRegister({ ...validRegistration, password: '123456' });

    expect(res.status).toBe(201);
  });

  test('rejects a password of 5 characters (just below the minimum)', async () => {
    const res = await postRegister({ ...validRegistration, password: '12345' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Password must be at least 6 characters');
    expect(User.create).not.toHaveBeenCalled();
  });
});

// =====================================================================
// REGISTER - INVALID / ERROR CASES
// =====================================================================
describe('POST /api/register - invalid and error cases', () => {
  test('rejects registration when name, email or password is missing', async () => {
    const fields = ['name', 'email', 'password'];

    for (const field of fields) {
      const body = { ...validRegistration };
      delete body[field];                              // remove one field at a time

      const res = await postRegister(body);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Name, email and password are required');
    }
    expect(User.create).not.toHaveBeenCalled();
  });

  test('rejects a duplicate email', async () => {
    User.findOne.mockResolvedValue(savedUser);         // email already exists

    const res = await postRegister(validRegistration);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Email is already registered');
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
  });

  test('returns 500 when the database fails during registration', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); // keep output clean
    User.findOne.mockRejectedValue(new Error('Database down'));

    const res = await postRegister(validRegistration);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Server error');
    consoleSpy.mockRestore();
  });
});

// =====================================================================
// LOGIN - NORMAL CASES
// =====================================================================
describe('POST /api/login - normal cases', () => {
  test('logs in successfully with the correct email and password', async () => {
    User.findOne.mockResolvedValue(savedUser);
    bcrypt.compare.mockResolvedValue(true);

    const res = await postLogin({ email: 'vajra@test.com', password: 'secret123' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Login successful');
    expect(bcrypt.compare).toHaveBeenCalledWith('secret123', 'hashed-password');
  });

  test('returns the user information (and not the password) on login', async () => {
    User.findOne.mockResolvedValue(savedUser);
    bcrypt.compare.mockResolvedValue(true);

    const res = await postLogin({ email: 'vajra@test.com', password: 'secret123' });

    expect(res.body.user).toEqual({
      id: 'user-1',
      name: 'Vajra',
      email: 'vajra@test.com',
    });
    expect(res.body.user.password).toBeUndefined();
  });
});

// =====================================================================
// LOGIN - INVALID / ERROR CASES
// =====================================================================
describe('POST /api/login - invalid and error cases', () => {
  test('rejects login with an unknown email', async () => {
    User.findOne.mockResolvedValue(null);              // no such user

    const res = await postLogin({ email: 'nobody@test.com', password: 'secret123' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  test('rejects login with a wrong password', async () => {
    User.findOne.mockResolvedValue(savedUser);
    bcrypt.compare.mockResolvedValue(false);           // password does not match

    const res = await postLogin({ email: 'vajra@test.com', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
  });

  test('rejects login when email or password is missing', async () => {
    const res1 = await postLogin({ email: 'vajra@test.com' });      // no password
    const res2 = await postLogin({ password: 'secret123' });        // no email

    expect(res1.status).toBe(400);
    expect(res1.body.message).toBe('Email and password are required');
    expect(res2.status).toBe(400);
    expect(res2.body.message).toBe('Email and password are required');
    expect(User.findOne).not.toHaveBeenCalled();
  });
});