// checkout.js - order summary, coupon, shipping address, fake payment, create order

const user = getUser();
const cart = getCart();

// The coupon the server accepted for this cart: { code, discount, total, subtotal }
let appliedCoupon = null;

// You must be logged in to check out
if (!user) {
  window.location.href = 'login.html?next=checkout.html';
}

// Only book IDs and quantities are sent. Prices are never sent from the browser.
function cartPayload() {
  return cart.map((item) => ({ bookId: item.bookId, quantity: item.quantity }));
}

// Draws the order summary. When a coupon is applied, the discount comes from the server.
// The server recalculates the total again when the order is placed.
function renderSummary() {
  const summary = document.getElementById('summary');
  const subtotal = cartTotal(cart);
  const discount = appliedCoupon ? appliedCoupon.discount : 0;
  const payable = Math.round((subtotal - discount) * 100) / 100;

  const rows = cart
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.title)} × ${item.quantity}</td>
        <td style="text-align:right;">${formatPrice(item.price * item.quantity)}</td>
      </tr>`
    )
    .join('');

  const couponLine = appliedCoupon
    ? `<div class="summary-line discount">
         <span>Coupon ${escapeHtml(appliedCoupon.code)}</span>
         <span>− ${formatPrice(discount)}</span>
       </div>`
    : '';

  summary.innerHTML = `
    <table>${rows}</table>
    <div class="summary-line"><span>Subtotal</span><span>${formatPrice(subtotal)}</span></div>
    ${couponLine}
    <div class="total-row">Total payable: ${formatPrice(payable)}</div>`;
}

// Keeps the coupon box and its button in step with whether a coupon is applied
function updateCouponControls() {
  const input = document.getElementById('couponCode');
  const button = document.getElementById('applyCouponBtn');
  input.disabled = Boolean(appliedCoupon);
  button.textContent = appliedCoupon ? 'Remove' : 'Apply';
}

async function applyCoupon() {
  const input = document.getElementById('couponCode');
  const code = input.value.trim();

  if (!code) {
    showMessage('couponMessage', 'Please enter a coupon code', 'error');
    return;
  }

  try {
    appliedCoupon = await postJSON('/api/coupons/validate', {
      items: cartPayload(),
      couponCode: code,
    });
    showMessage(
      'couponMessage',
      `Coupon ${appliedCoupon.code} applied. You save ${formatPrice(appliedCoupon.discount)}`,
      'success'
    );
  } catch (err) {
    appliedCoupon = null;
    showMessage('couponMessage', err.message, 'error');
  }
  renderSummary();
  updateCouponControls();
}

function removeCoupon() {
  appliedCoupon = null;
  document.getElementById('couponCode').value = '';
  document.getElementById('couponMessage').className = 'message';
  renderSummary();
  updateCouponControls();
}

if (user && cart.length === 0) {
  // Empty cart -> nothing to check out
  document.getElementById('checkoutArea').innerHTML = `
    <div class="card" style="grid-column: 1 / -1;">
      <p class="center muted">Your cart is empty.</p>
      <p class="center"><a class="btn" href="index.html">Browse Books</a></p>
    </div>`;
} else if (user) {
  renderSummary();
  document.getElementById('fullName').value = user.name; // small convenience

  document.getElementById('applyCouponBtn').addEventListener('click', () => {
    if (appliedCoupon) {
      removeCoupon();
    } else {
      applyCoupon();
    }
  });
}

// "Pay Now" button = form submit
const form = document.getElementById('checkoutForm');
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // A typed coupon must be applied first, so the customer sees the discount before paying
    const typedCode = document.getElementById('couponCode').value.trim();
    if (!appliedCoupon && typedCode) {
      showMessage('couponMessage', 'Click Apply to use this coupon, or clear the box', 'error');
      return;
    }

    const payBtn = document.getElementById('payBtn');
    payBtn.disabled = true;
    payBtn.textContent = 'Processing payment...';

    const body = {
      items: cartPayload(),
      shippingAddress: {
        fullName: document.getElementById('fullName').value.trim(),
        address: document.getElementById('address').value.trim(),
        city: document.getElementById('city').value.trim(),
        pincode: document.getElementById('pincode').value.trim(),
        phone: document.getElementById('phone').value.trim(),
      },
      couponCode: appliedCoupon ? appliedCoupon.code : undefined,
    };

    try {
      // Fake payment: wait 1 second, pretend it succeeded, then create the order
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const result = await postJSON('/api/orders', body);

      clearCart();
      renderNavbar();

      const discountLine =
        result.discount > 0
          ? `<p><strong>Discount:</strong> − ${formatPrice(result.discount)}</p>`
          : '';

      const emailNotes = {
        sent: `A confirmation email was sent to ${(getUser() || {}).email || 'your email address'}.`,
        preview: 'Email is not configured on this server, so no email was sent (preview mode).',
        failed: 'Your order is saved, but we could not send the confirmation email.',
      };
      const emailLine = emailNotes[result.emailStatus]
        ? `<p class="muted">${escapeHtml(emailNotes[result.emailStatus])}</p>`
        : '';

      document.getElementById('checkoutArea').innerHTML = `
        <div class="card center" style="grid-column: 1 / -1;">
          <h2>🎉 Payment successful!</h2>
          <p>Your order has been placed.</p>
          <p><strong>Order ID:</strong> ${escapeHtml(result.orderId)}</p>
          <p><strong>Subtotal:</strong> ${formatPrice(result.subtotal)}</p>
          ${discountLine}
          <p><strong>Total paid:</strong> ${formatPrice(result.total)}</p>
          ${emailLine}
          <a class="btn" href="index.html">Continue Shopping</a>
        </div>`;
    } catch (err) {
      showMessage('message', err.message, 'error');
      payBtn.disabled = false;
      payBtn.textContent = 'Pay Now (Fake Payment)';
    }
  });
}
