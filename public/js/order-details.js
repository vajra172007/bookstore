// order-details.js - one order of the logged-in customer. Another customer's order shows "not found".

function formatDateTime(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderOrder(order) {
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

  const a = order.shippingAddress || {};
  const cls = order.status === 'Placed' ? 'badge-ok' : 'badge-out';

  return `
    <div class="card">
      <div class="order-head">
        <div>
          <strong>Order #${escapeHtml(order.id)}</strong>
          <div class="muted">${escapeHtml(formatDateTime(order.createdAt))}</div>
        </div>
        <span class="badge ${cls}">${escapeHtml(order.status)}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Book</th><th>Qty</th><th>Price</th><th style="text-align:right;">Amount</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="summary-line"><span>Subtotal</span><span>${formatPrice(order.subtotal)}</span></div>
      ${discount}
      <div class="total-row">Total: ${formatPrice(order.total)}</div>
      <p class="muted">Payment: ${escapeHtml(order.paymentStatus || '')}</p>
    </div>
    <div class="card">
      <h2>Shipping Address</h2>
      <p>${escapeHtml(a.fullName)}<br>${escapeHtml(a.address)}<br>${escapeHtml(a.city)} - ${escapeHtml(a.pincode)}<br>Phone: ${escapeHtml(a.phone)}</p>
    </div>`;
}

async function loadOrder() {
  const area = document.getElementById('orderArea');

  if (!getUser() || !getToken()) {
    const next = encodeURIComponent('order-details.html' + window.location.search);
    window.location.href = 'login.html?next=' + next;
    return;
  }

  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) {
    area.innerHTML = '';
    showMessage('message', 'No order selected', 'error');
    area.innerHTML = '<p class="center"><a class="btn" href="orders.html">Go to My Orders</a></p>';
    return;
  }

  try {
    const data = await api('/api/orders/' + encodeURIComponent(id));
    area.innerHTML = renderOrder(data.order);
  } catch (err) {
    showMessage('message', err.message, 'error');
    area.innerHTML = '<p class="center"><a class="btn" href="orders.html">Back to My Orders</a></p>';
  }
}

loadOrder();
