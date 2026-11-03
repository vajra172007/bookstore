// admin-reports.js - sales and inventory dashboard (admin/staff only; the API enforces this)

const filterForm = document.getElementById('filterForm');
const statusBox = document.getElementById('status');
const reportBody = document.getElementById('reportBody');
let requestId = 0; // ignore out-of-date responses if the filter changes quickly

function stat(label, value, cls) {
  return `<div class="stat ${cls || ''}"><div class="stat-value">${escapeHtml(value)}</div><div class="stat-label">${escapeHtml(label)}</div></div>`;
}

function table(headers, rows, emptyText) {
  if (rows.length === 0) return `<p class="muted center">${escapeHtml(emptyText)}</p>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function stockTable(books, emptyText) {
  return table(
    ['Title', 'Author', 'Category', 'ISBN', 'Price', 'Stock'],
    books.map(
      (b) => `<tr><td>${escapeHtml(b.title)}</td><td>${escapeHtml(b.author)}</td><td>${escapeHtml(b.category)}</td>
        <td>${escapeHtml(b.isbn)}</td><td>${formatPrice(b.price)}</td>
        <td><span class="badge ${b.stock > 0 ? 'badge-warn' : 'badge-out'}">${b.stock}</span></td></tr>`
    ),
    emptyText
  );
}

function renderSales(s) {
  document.getElementById('salesStats').innerHTML =
    stat('Sales revenue', formatPrice(s.revenue)) +
    stat('Total orders', s.totalOrders) +
    stat('Completed orders', s.completedOrders) +
    stat('Books sold', s.booksSold) +
    stat('Cancelled orders', s.cancelledOrders, 'stat-muted') +
    stat('Refunded orders', s.refundedOrders, 'stat-muted');

  document.getElementById('bestSellers').innerHTML = table(
    ['#', 'Book', 'Quantity sold', 'Sales (before coupons)'],
    s.bestSellers.map(
      (b, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(b.title)}</td><td>${b.quantitySold}</td><td>${formatPrice(b.revenue)}</td></tr>`
    ),
    'No sales in this period.'
  );
}

function renderInventory(v) {
  document.getElementById('invStats').innerHTML =
    stat('Book titles', v.totalTitles) +
    stat('Units in stock', v.totalUnits) +
    stat('Stock value', formatPrice(v.inventoryValue)) +
    stat(`Low stock (1-${v.threshold})`, v.lowStockCount, v.lowStockCount ? 'stat-warn' : '') +
    stat('Out of stock', v.outOfStockCount, v.outOfStockCount ? 'stat-bad' : '');

  const note = (count, shown) =>
    count > shown ? `<p class="muted">Showing the first ${shown} of ${count}.</p>` : '';
  document.getElementById('lowStock').innerHTML =
    stockTable(v.lowStockBooks, 'No low-stock books.') + note(v.lowStockCount, v.lowStockBooks.length);
  document.getElementById('outStock').innerHTML =
    stockTable(v.outOfStockBooks, 'No out-of-stock books.') + note(v.outOfStockCount, v.outOfStockBooks.length);
}

// Date inputs are local days: send the exact local start/end so "today" matches the user's clock
function dayStart(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}
function dayEnd(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

async function loadReports() {
  const from = document.getElementById('fromDate').value;
  const to = document.getElementById('toDate').value;
  const threshold = document.getElementById('threshold').value || '5';

  if (from && to && from > to) {
    showMessage('status', '"From" date must not be after "To" date', 'error');
    return;
  }
  if (!getToken()) {
    reportBody.hidden = true;
    showMessage('status', 'Please log in with an admin or staff account to view reports.', 'error');
    return;
  }

  const params = new URLSearchParams();
  if (from) params.set('from', dayStart(from));
  if (to) params.set('to', dayEnd(to));
  const salesQuery = params.toString();

  const myId = ++requestId;
  reportBody.hidden = true;
  showMessage('status', 'Loading reports...', 'success');

  try {
    const [sales, inventory] = await Promise.all([
      api('/api/reports/sales' + (salesQuery ? '?' + salesQuery : '')),
      api('/api/reports/inventory?threshold=' + encodeURIComponent(threshold)),
    ]);
    if (myId !== requestId) return;
    renderSales(sales);
    renderInventory(inventory);
    document.getElementById('rangeNote').textContent =
      from || to ? `Sales shown for ${from || 'the beginning'} to ${to || 'today'}.` : 'Sales shown for all time.';
    statusBox.className = 'message';
    statusBox.textContent = '';
    reportBody.hidden = false;
  } catch (err) {
    if (myId !== requestId) return;
    showMessage('status', 'Could not load reports: ' + err.message, 'error');
  }
}

filterForm.addEventListener('submit', (e) => {
  e.preventDefault();
  loadReports();
});
document.getElementById('clearBtn').addEventListener('click', () => {
  document.getElementById('fromDate').value = '';
  document.getElementById('toDate').value = '';
  loadReports();
});

loadReports();
