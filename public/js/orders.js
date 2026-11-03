// orders.js - customer order history. The server decides which orders belong to the logged-in user
// (from the token); this page never sends a user id.

function formatDate(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusBadge(status) {
  const cls = status === 'Placed' ? 'badge-ok' : 'badge-out';
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

function renderOrderCard(order) {
  const rows = order.items
    .map(
      (i) => `
      <tr>
        <td>${escapeHtml(i.title)}</td>
        <td>${i.quantity}</td>
        <td>${formatPrice(i.price)}</td>
        <td style="text-align:right;">${formatPrice(i.lineTotal)}</td>
      </tr>`
    )
    .join('');

  const discount =
    order.discountAmount > 0
      ? `<div class="summary-line discount"><span>Coupon ${escapeHtml(order.couponCode || '')}</span><span>− ${formatPrice(order.discountAmount)}</span></div>`
      : '';

  return `
    <div class="card order-card">
      <div class="order-head">
        <div>
          <strong>Order #${escapeHtml(order.id)}</strong>
          <div class="muted">${escapeHtml(formatDate(order.createdAt))}</div>
        </div>
        ${statusBadge(order.status)}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Book</th><th>Qty</th><th>Price</th><th style="text-align:right;">Amount</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="summary-line"><span>Subtotal</span><span>${formatPrice(order.subtotal)}</span></div>
      ${discount}
      <div class="summary-line"><strong>Total</strong><strong>${formatPrice(order.total)}</strong></div>
      <a class="btn btn-small" href="order-details.html?id=${encodeURIComponent(order.id)}">View details</a>
    </div>`;
}

async function loadOrders() {
  const area = document.getElementById('ordersArea');

  if (!getUser() || !getToken()) {
    window.location.href = 'login.html?next=orders.html';
    return;
  }

  try {
    const data = await api('/api/orders/mine');
    if (!data.orders || data.orders.length === 0) {
      area.innerHTML = `
        <div class="card center">
          <p class="muted">You have not placed any orders yet.</p>
          <a class="btn" href="index.html">Browse Books</a>
        </div>`;
      return;
    }
    area.innerHTML = data.orders.map(renderOrderCard).join('');
  } catch (err) {
    area.innerHTML = '';
    showMessage('message', err.message, 'error');
    // An expired or missing session: send the customer back to login
    if (/login/i.test(err.message)) {
      setTimeout(() => (window.location.href = 'login.html?next=orders.html'), 1500);
    } else {
      area.innerHTML = '<p class="center"><button class="btn" id="retryBtn">Try again</button></p>';
      document.getElementById('retryBtn').addEventListener('click', () => {
        document.getElementById('message').className = 'message';
        area.innerHTML = '<p class="center muted">Loading your orders...</p>';
        loadOrders();
      });
    }
  }
}

loadOrders();
