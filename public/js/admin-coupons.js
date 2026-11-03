// admin-coupons.js - create, edit, activate and deactivate coupons (admin/staff only)

const form = document.getElementById('couponForm');
const tableBox = document.getElementById('couponTable');
const saveBtn = document.getElementById('saveBtn');
const cancelBtn = document.getElementById('cancelBtn');
const formTitle = document.getElementById('formTitle');

let coupons = [];
let editingId = null;

function val(id) {
  return document.getElementById(id).value.trim();
}

// Converts a stored date into the text format a datetime-local input needs (in local time)
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function describeValue(c) {
  return c.type === 'percentage' ? `${c.value}%` : formatPrice(c.value);
}

function describeValidity(c) {
  const from = c.validFrom ? new Date(c.validFrom).toLocaleDateString('en-IN') : 'any time';
  const until = c.validUntil ? new Date(c.validUntil).toLocaleDateString('en-IN') : 'no end date';
  return `${from} to ${until}`;
}

function renderTable() {
  if (coupons.length === 0) {
    tableBox.innerHTML = '<p class="muted center">No coupons yet. Use the form to create one.</p>';
    return;
  }

  const rows = coupons
    .map(
      (c) => `
    <tr>
      <td><strong>${escapeHtml(c.code)}</strong><br><span class="muted">${escapeHtml(c.description)}</span></td>
      <td>${describeValue(c)}${c.maxDiscount ? `<br><span class="muted">max ${formatPrice(c.maxDiscount)}</span>` : ''}</td>
      <td>${c.minPurchase ? formatPrice(c.minPurchase) : '—'}</td>
      <td>${escapeHtml(describeValidity(c))}</td>
      <td>${c.usedCount} / ${c.usageLimit === null || c.usageLimit === undefined ? '∞' : c.usageLimit}</td>
      <td><span class="badge ${c.active ? 'badge-ok' : 'badge-out'}">${c.active ? 'Active' : 'Inactive'}</span></td>
      <td class="actions">
        <button class="btn btn-small" data-action="edit" data-id="${c._id}">Edit</button>
        <button class="btn btn-small ${c.active ? 'btn-red' : 'btn-green'}" data-action="toggle" data-id="${c._id}">
          ${c.active ? 'Deactivate' : 'Activate'}
        </button>
      </td>
    </tr>`
    )
    .join('');

  tableBox.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Code</th><th>Discount</th><th>Min. purchase</th><th>Valid</th>
          <th>Used</th><th>Status</th><th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function loadCoupons() {
  try {
    coupons = await api('/api/coupons');
    renderTable();
  } catch (err) {
    tableBox.innerHTML = '';
    showMessage('message', err.message, 'error');
  }
}

// Reads the form into the shape the server expects
function readForm() {
  return {
    code: val('code'),
    description: val('description'),
    type: val('type'),
    value: val('value'),
    minPurchase: val('minPurchase') || 0,
    maxDiscount: val('maxDiscount') || null,
    validFrom: val('validFrom') || null,
    validUntil: val('validUntil') || null,
    usageLimit: val('usageLimit') || null,
    active: document.getElementById('active').checked,
  };
}

function resetForm() {
  form.reset();
  document.getElementById('minPurchase').value = 0;
  editingId = null;
  formTitle.textContent = 'Create coupon';
  saveBtn.textContent = 'Create Coupon';
  cancelBtn.hidden = true;
}

function startEdit(c) {
  editingId = c._id;
  document.getElementById('code').value = c.code;
  document.getElementById('description').value = c.description || '';
  document.getElementById('type').value = c.type;
  document.getElementById('value').value = c.value;
  document.getElementById('minPurchase').value = c.minPurchase || 0;
  document.getElementById('maxDiscount').value = c.maxDiscount ?? '';
  document.getElementById('validFrom').value = toLocalInput(c.validFrom);
  document.getElementById('validUntil').value = toLocalInput(c.validUntil);
  document.getElementById('usageLimit').value = c.usageLimit ?? '';
  document.getElementById('active').checked = c.active;

  formTitle.textContent = `Edit ${c.code}`;
  saveBtn.textContent = 'Save Changes';
  cancelBtn.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function toggleCoupon(c) {
  try {
    const updated = await sendJSON(`/api/coupons/${c._id}/status`, 'PATCH', { active: !c.active });
    showMessage('message', `${updated.code} is now ${updated.active ? 'active' : 'inactive'}`, 'success');
    await loadCoupons();
  } catch (err) {
    showMessage('message', err.message, 'error');
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = readForm();

  try {
    if (editingId) {
      await sendJSON(`/api/coupons/${editingId}`, 'PUT', body);
      showMessage('message', 'Coupon updated', 'success');
    } else {
      await sendJSON('/api/coupons', 'POST', body);
      showMessage('message', 'Coupon created', 'success');
    }
    resetForm();
    await loadCoupons();
  } catch (err) {
    showMessage('message', err.message, 'error');
  }
});

cancelBtn.addEventListener('click', () => {
  resetForm();
  showMessage('message', '', '');
});

tableBox.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const coupon = coupons.find((c) => c._id === btn.dataset.id);
  if (!coupon) return;

  if (btn.dataset.action === 'edit') startEdit(coupon);
  if (btn.dataset.action === 'toggle') toggleCoupon(coupon);
});

loadCoupons();
