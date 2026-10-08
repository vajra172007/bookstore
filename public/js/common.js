// common.js - helpers shared by every page (loaded BEFORE the page's own JS file)

// ---------- Placeholder image (used when a book image fails to load) ----------
const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400">' +
      '<rect width="100%" height="100%" fill="#e5e7eb"/>' +
      '<text x="50%" y="50%" font-family="Arial" font-size="22" fill="#6b7280" text-anchor="middle">No Image</text>' +
      '</svg>'
  );

// Builds an <img> tag that falls back to the placeholder
function imgTag(url, alt) {
  return `<img src="${escapeHtml(url || PLACEHOLDER)}" alt="${escapeHtml(alt)}"
    onerror="this.onerror=null;this.src=PLACEHOLDER"
    onload="if(this.naturalWidth<10){this.src=PLACEHOLDER}">`;
}

// ---------- Small utilities ----------
// Prevents HTML injection when we put text from the database into the page
function escapeHtml(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(n) {
  return '₹' + Number(n).toLocaleString('en-IN');
}

// Shows a success/error message inside the element with the given id
function showMessage(elementId, text, type) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.className = 'message ' + type; // type = 'success' or 'error'
  el.textContent = text;
}

// ---------- API helpers ----------
// Calls the backend and returns JSON. Throws an Error with the server's message on failure.
async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || 'Something went wrong');
  }
  return data;
}

function postJSON(url, body) {
  return api(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------- Logged-in user (kept in localStorage) ----------
function getUser() {
  try {
    return JSON.parse(localStorage.getItem('user'));
  } catch (e) {
    return null;
  }
}
function setUser(user) {
  localStorage.setItem('user', JSON.stringify(user));
}
function logout() {
  localStorage.removeItem('user');
  window.location.href = 'index.html';
}

// ---------- Cart (kept in localStorage) ----------
// Each cart item: { bookId, title, price, image, stock, quantity }
function getCart() {
  try {
    return JSON.parse(localStorage.getItem('cart')) || [];
  } catch (e) {
    return [];
  }
}
function saveCart(cart) {
  localStorage.setItem('cart', JSON.stringify(cart));
}
function clearCart() {
  localStorage.removeItem('cart');
}
function cartTotal(cart) {
  return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

// Adds 1 copy of a book to the cart. Returns { ok: true/false, message }
function addToCart(book) {
  const cart = getCart();
  const existing = cart.find((item) => item.bookId === book._id);
  const currentQty = existing ? existing.quantity : 0;

  if (book.stock < 1) {
    return { ok: false, message: 'This book is out of stock' };
  }
  if (currentQty + 1 > book.stock) {
    return { ok: false, message: `Only ${book.stock} copies available. You already have ${currentQty} in your cart` };
  }

  if (existing) {
    existing.quantity += 1;
    existing.stock = book.stock;
  } else {
    cart.push({
      bookId: book._id,
      title: book.title,
      price: book.price,
      image: book.image,
      stock: book.stock,
      quantity: 1,
    });
  }
  saveCart(cart);
  renderNavbar(); // update the cart count
  return { ok: true, message: `"${book.title}" added to cart` };
}

// ---------- Navbar (same on every page) ----------
function renderNavbar() {
  const nav = document.getElementById('navbar');
  if (!nav) return;

  const user = getUser();
  const count = getCart().reduce((sum, item) => sum + item.quantity, 0);

  const userLinks = user
    ? `<span>Hi, ${escapeHtml(user.name)}</span><button id="logoutBtn">Logout</button>`
    : `<a href="login.html">Login</a><a href="register.html">Register</a>`;

  nav.innerHTML = `
    <div class="nav-inner">
      <a class="brand" href="index.html">📚 BookNest</a>
      <div class="nav-links">
        <a href="index.html">Home</a>
        <a href="admin.html">Admin</a>
        <a href="cart.html">Cart (${count})</a>
        ${userLinks}
      </div>
    </div>`;

  const btn = document.getElementById('logoutBtn');
  if (btn) btn.addEventListener('click', logout);
}

document.addEventListener('DOMContentLoaded', renderNavbar);