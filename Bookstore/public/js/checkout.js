// checkout.js - show order summary, take address, fake payment, create order

const user = getUser();
const cart = getCart();

// You must be logged in to check out
if (!user) {
  window.location.href = 'login.html?next=checkout.html';
}

// Draw the order summary on the right side
function renderSummary() {
  const summary = document.getElementById('summary');
  const rows = cart
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.title)} × ${item.quantity}</td>
        <td style="text-align:right;">${formatPrice(item.price * item.quantity)}</td>
      </tr>`
    )
    .join('');

  summary.innerHTML = `
    <table>${rows}</table>
    <div class="total-row">Total: ${formatPrice(cartTotal(cart))}</div>`;
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
}

// "Pay Now" button = form submit
const form = document.getElementById('checkoutForm');
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payBtn = document.getElementById('payBtn');
    payBtn.disabled = true;
    payBtn.textContent = 'Processing payment...';

    const body = {
      userId: user.id,
      items: cart.map((item) => ({ bookId: item.bookId, quantity: item.quantity })),
      shippingAddress: {
        fullName: document.getElementById('fullName').value.trim(),
        address: document.getElementById('address').value.trim(),
        city: document.getElementById('city').value.trim(),
        pincode: document.getElementById('pincode').value.trim(),
        phone: document.getElementById('phone').value.trim(),
      },
    };

    try {
      // Fake payment: wait 1 second, pretend it succeeded, then create the order
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const result = await postJSON('/api/orders', body);

      clearCart();
      renderNavbar();

      document.getElementById('checkoutArea').innerHTML = `
        <div class="card center" style="grid-column: 1 / -1;">
          <h2>🎉 Payment successful!</h2>
          <p>Your order has been placed.</p>
          <p><strong>Order ID:</strong> ${escapeHtml(result.orderId)}</p>
          <p><strong>Total paid:</strong> ${formatPrice(result.total)}</p>
          <a class="btn" href="index.html">Continue Shopping</a>
        </div>`;
    } catch (err) {
      showMessage('message', err.message, 'error');
      payBtn.disabled = false;
      payBtn.textContent = 'Pay Now (Fake Payment)';
    }
  });
}