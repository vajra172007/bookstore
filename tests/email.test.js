// tests/email.test.js - order confirmation email (services/email.js)
// buildOrderEmail is a pure function, so it is tested directly. Preview mode writes a file,
// so the file system calls are replaced with spies. No SMTP connection is ever opened.
const fs = require('fs');
const { buildOrderEmail, sendOrderConfirmation } = require('../services/email');

const ORDER_ID = '64b7f0f2f2f2f2f2f2f2f2e1';
const user = { name: 'Vajra', email: 'vajra@example.com' };

function makeOrder(overrides = {}) {
  return {
    _id: ORDER_ID,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    status: 'Placed',
    items: [{ title: 'Clean Code', quantity: 2, price: 500 }],
    subtotal: 1000,
    couponCode: 'SAVE10',
    discountAmount: 100,
    total: 900,
    shippingAddress: { fullName: 'Vajra', address: '12 Main Street', city: 'Coimbatore', pincode: '641001', phone: '9876543210' },
    ...overrides,
  };
}

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
  jest.restoreAllMocks();
});

// =====================================================================
// Building the email
// =====================================================================
describe('buildOrderEmail - content', () => {
  test('the subject names the order id', () => {
    const { subject } = buildOrderEmail(makeOrder(), user);
    expect(subject).toBe(`BookNest order confirmation #${ORDER_ID}`);
  });

  test('the text version shows the order id and the amount paid', () => {
    const { text } = buildOrderEmail(makeOrder(), user);
    expect(text).toContain(`Order ID: ${ORDER_ID}`);
    expect(text).toContain('Total paid: Rs. 900.00');
  });

  test('each item shows quantity, unit price and line total', () => {
    const { text } = buildOrderEmail(makeOrder(), user);
    expect(text).toContain('- Clean Code | Qty 2 x Rs. 500.00 = Rs. 1,000.00');
  });

  test('the coupon line shows the code and the discount when one was used', () => {
    const { text, html } = buildOrderEmail(makeOrder(), user);
    expect(text).toContain('Coupon discount (SAVE10): -Rs. 100.00');
    expect(html).toContain('Coupon discount (SAVE10)');
  });

  test('there is no coupon line when no discount was applied', () => {
    const { text, html } = buildOrderEmail(makeOrder({ couponCode: null, discountAmount: 0, total: 1000 }), user);
    expect(text).not.toContain('Coupon discount');
    expect(html).not.toContain('Coupon discount');
  });

  test('a discount with no coupon code is still shown, without a code', () => {
    const { text } = buildOrderEmail(makeOrder({ couponCode: null }), user);
    expect(text).toContain('Coupon discount: -Rs. 100.00');
  });

  test('large amounts use Indian digit grouping (lakhs) and two decimals', () => {
    const order = makeOrder({ items: [{ title: 'Set', quantity: 1, price: 123456.5 }], subtotal: 123456.5, discountAmount: 0, couponCode: null, total: 123456.5 });
    const { text } = buildOrderEmail(order, user);
    expect(text).toContain('Total paid: Rs. 1,23,456.50');
  });

  test('status defaults to Placed when the order has none (older orders)', () => {
    const { text } = buildOrderEmail(makeOrder({ status: undefined }), user);
    expect(text).toContain('Status: Placed');
  });

  test('the cancelled status is shown when the order is cancelled', () => {
    const { text } = buildOrderEmail(makeOrder({ status: 'Cancelled' }), user);
    expect(text).toContain('Status: Cancelled');
  });

  test('an older order with no stored subtotal shows the sum of its items', () => {
    const order = makeOrder({ subtotal: null, discountAmount: 0, couponCode: null, total: 300, items: [{ title: 'Old', quantity: 3, price: 100 }] });
    const { text } = buildOrderEmail(order, user);
    expect(text).toContain('Subtotal: Rs. 300.00');
  });

  test('the date is shown in Indian time (IST)', () => {
    const { text } = buildOrderEmail(makeOrder(), user);
    expect(text).toMatch(/Date: .* IST/);
  });

  test('the shipping address is included', () => {
    const { text } = buildOrderEmail(makeOrder(), user);
    expect(text).toContain('Shipping to: Vajra, 12 Main Street, Coimbatore 641001');
  });
});

describe('buildOrderEmail - HTML safety', () => {
  test('a book title containing HTML is escaped, not run as markup', () => {
    const order = makeOrder({ items: [{ title: '<img src=x onerror=alert(1)>', quantity: 1, price: 10 }], subtotal: 10, total: 10, discountAmount: 0, couponCode: null });
    const { html } = buildOrderEmail(order, user);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('the customer name and shipping address are escaped', () => {
    const order = makeOrder({ shippingAddress: { fullName: '<b>Bad</b>', address: 'A & B "C"', city: 'X', pincode: '1', phone: '1' } });
    const { html } = buildOrderEmail(order, { name: '<script>x</script>', email: 'a@b.co' });
    expect(html).not.toContain('<b>Bad</b>');
    expect(html).toContain('&lt;b&gt;Bad&lt;/b&gt;');
    expect(html).toContain('A &amp; B &quot;C&quot;');
    expect(html).not.toContain('<script>x</script>');
  });

  test('the HTML version is a complete HTML document', () => {
    const { html } = buildOrderEmail(makeOrder(), user);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('</html>');
  });
});

// =====================================================================
// Sending decisions (never throws; reports what happened)
// =====================================================================
describe('sendOrderConfirmation - when nothing is sent', () => {
  test('skipped under Jest (NODE_ENV=test): no file, no connection', async () => {
    const spy = jest.spyOn(fs, 'writeFileSync');
    const result = await sendOrderConfirmation(makeOrder(), user);
    expect(result).toEqual({ status: 'skipped', reason: 'Test environment' });
    expect(spy).not.toHaveBeenCalled();
  });

  test('skipped when the customer has no email address', async () => {
    process.env.NODE_ENV = 'development';
    const result = await sendOrderConfirmation(makeOrder(), { name: 'No Mail' });
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('No customer email');
  });
});

describe('sendOrderConfirmation - preview mode (no credentials)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_APP_PASSWORD;
  });

  test('without credentials the email is saved as a preview and NOT sent', async () => {
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    const write = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});

    const result = await sendOrderConfirmation(makeOrder(), user);

    expect(result.status).toBe('preview');
    expect(write).toHaveBeenCalledTimes(1);
    const [file, content] = write.mock.calls[0];
    expect(file).toMatch(new RegExp(`order-${ORDER_ID}\\.html$`));
    expect(content).toContain('NOT SENT (preview mode)');
    expect(content).toContain('To: vajra@example.com');
  });

  test('only one of the two credentials set still counts as preview mode', async () => {
    process.env.EMAIL_USER = 'shop@gmail.com';
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const result = await sendOrderConfirmation(makeOrder(), user);
    expect(result.status).toBe('preview');
  });

  test('a file-system error becomes status "failed" and does not throw', async () => {
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw new Error('read-only file system'); });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await sendOrderConfirmation(makeOrder(), user);
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('Email could not be delivered');
  });
});
