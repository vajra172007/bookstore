// services/email.js - order confirmation email (Nodemailer + Gmail SMTP, or a local preview file)
const fs = require('fs');
const path = require('path');

const PREVIEW_DIR = path.join(__dirname, '..', 'email-previews');
const money = (n) => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function esc(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Builds subject, plain text and HTML from the SAVED order and the user.
function buildOrderEmail(order, user) {
  const id = String(order._id);
  const date = new Date(order.createdAt || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST';
  const status = order.status || 'Placed';
  const items = (order.items || []).map((i) => ({
    title: i.title, quantity: i.quantity, price: i.price, line: Math.round(i.price * i.quantity * 100) / 100,
  }));
  const itemsTotal = Math.round(items.reduce((s, i) => s + i.line, 0) * 100) / 100;
  const subtotal = order.subtotal === null || order.subtotal === undefined ? itemsTotal : order.subtotal;
  const discount = order.discountAmount || 0;
  const a = order.shippingAddress || {};

  const text = [
    `Hi ${user.name},`, '', 'Thank you for your order at BookNest.', '',
    `Order ID: ${id}`, `Date: ${date}`, `Status: ${status}`, '', 'Items:',
    ...items.map((i) => `- ${i.title} | Qty ${i.quantity} x ${money(i.price)} = ${money(i.line)}`), '',
    `Subtotal: ${money(subtotal)}`,
    ...(discount > 0 ? [`Coupon discount${order.couponCode ? ' (' + order.couponCode + ')' : ''}: -${money(discount)}`] : []),
    `Total paid: ${money(order.total)}`, '',
    `Shipping to: ${a.fullName || ''}, ${a.address || ''}, ${a.city || ''} ${a.pincode || ''}`,
  ].join('\n');

  const rows = items.map((i) =>
    `<tr><td style="padding:6px;border-bottom:1px solid #e5e7eb">${esc(i.title)}</td>` +
    `<td style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:center">${esc(i.quantity)}</td>` +
    `<td style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right">${money(i.price)}</td>` +
    `<td style="padding:6px;border-bottom:1px solid #e5e7eb;text-align:right">${money(i.line)}</td></tr>`).join('');
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1f2937;max-width:600px;margin:auto">
<h2>📚 BookNest - Order confirmation</h2>
<p>Hi ${esc(user.name)}, thank you for your order.</p>
<p><strong>Order ID:</strong> ${esc(id)}<br><strong>Date:</strong> ${esc(date)}<br><strong>Status:</strong> ${esc(status)}</p>
<table style="width:100%;border-collapse:collapse"><thead><tr><th align="left">Book</th><th>Qty</th><th align="right">Price</th><th align="right">Line total</th></tr></thead><tbody>${rows}</tbody></table>
<p style="text-align:right">Subtotal: ${money(subtotal)}<br>${discount > 0 ? `Coupon discount${order.couponCode ? ' (' + esc(order.couponCode) + ')' : ''}: -${money(discount)}<br>` : ''}<strong>Total paid: ${money(order.total)}</strong></p>
<p><strong>Shipping to:</strong><br>${esc(a.fullName)}<br>${esc(a.address)}<br>${esc(a.city)} ${esc(a.pincode)}</p>
</body></html>`;

  return { subject: `BookNest order confirmation #${id}`, text, html };
}

function hasCredentials() {
  return Boolean(process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD);
}

// Sends (or previews) the confirmation. NEVER throws. Returns one of:
//   { status: 'sent' }                    SMTP server accepted the message for the recipient
//   { status: 'preview', file }           no credentials: saved to email-previews/, NOT sent
//   { status: 'failed', reason }          SMTP or setup problem (reason is generic, no secrets)
//   { status: 'skipped', reason }         nothing to do (no recipient, or running under Jest)
async function sendOrderConfirmation(order, user) {
  try {
    if (!user || !user.email) return { status: 'skipped', reason: 'No customer email' };
    if (process.env.NODE_ENV === 'test') return { status: 'skipped', reason: 'Test environment' };
    const mail = buildOrderEmail(order, user);

    if (!hasCredentials()) {
      fs.mkdirSync(PREVIEW_DIR, { recursive: true });
      const file = path.join(PREVIEW_DIR, `order-${String(order._id)}.html`);
      fs.writeFileSync(file, `<!-- To: ${esc(user.email)} | Subject: ${esc(mail.subject)} | NOT SENT (preview mode) -->\n` + mail.html);
      console.log(`Email preview mode (EMAIL_USER / EMAIL_APP_PASSWORD not set): saved ${file}`);
      return { status: 'preview', file };
    }

    const nodemailer = require('nodemailer'); // loaded only when really sending
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    });
    const info = await transporter.sendMail({
      from: `"BookNest" <${process.env.EMAIL_USER}>`,
      to: user.email, subject: mail.subject, text: mail.text, html: mail.html,
    });
    const accepted = (info.accepted || []).map((x) => String(x).toLowerCase());
    if (accepted.includes(String(user.email).toLowerCase()) && (info.rejected || []).length === 0) {
      return { status: 'sent' };
    }
    return { status: 'failed', reason: 'The mail server did not accept the recipient' };
  } catch (err) {
    // Log only the error code, never the message body or credentials
    console.error('Order email failed:', err && (err.code || err.responseCode || err.name));
    return { status: 'failed', reason: 'Email could not be delivered' };
  }
}

module.exports = { buildOrderEmail, sendOrderConfirmation };
