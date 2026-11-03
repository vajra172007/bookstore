// cart.js - view the cart, change quantity, remove books

const cartBox = document.getElementById('cartBox');

// Refresh price and stock of every cart item from the database,
// so the cart never uses outdated information.
async function syncCart() {
  const updated = [];
  for (const item of getCart()) {
    try {
      const book = await api('/api/books/' + item.bookId);
      if (book.stock < 1) continue; // sold out -> drop from cart
      updated.push({
        bookId: book._id,
        title: book.title,
        price: book.price,
        image: book.image,
        stock: book.stock,
        quantity: Math.min(item.quantity, book.stock), // never more than stock
      });
    } catch (err) {
      // If the book was deleted, drop it. For other errors keep the item.
      if (err.message !== 'Book not found') updated.push(item);
    }
  }
  saveCart(updated);
}

// Draw the cart table
function renderCart() {
  const cart = getCart();
  renderNavbar();

  if (cart.length === 0) {
    cartBox.innerHTML = `
      <p class="center muted">Your cart is empty.</p>
      <p class="center"><a class="btn" href="index.html">Browse Books</a></p>`;
    return;
  }

  const rows = cart
    .map(
      (item) => `
      <tr>
        <td>${imgTag(item.image, item.title)}</td>
        <td>${escapeHtml(item.title)}<br><span class="muted">Stock: ${item.stock}</span></td>
        <td>${formatPrice(item.price)}</td>
        <td>
          <div class="qty-box">
            <button data-action="dec" data-id="${item.bookId}">−</button>
            <input type="number" min="1" max="${item.stock}" value="${item.quantity}" data-id="${item.bookId}" class="qty-input">
            <button data-action="inc" data-id="${item.bookId}">+</button>
          </div>
        </td>
        <td>${formatPrice(item.price * item.quantity)}</td>
        <td><button class="btn btn-red" data-action="remove" data-id="${item.bookId}">Remove</button></td>
      </tr>`
    )
    .join('');

  cartBox.innerHTML = `
    <table>
      <thead>
        <tr><th></th><th>Book</th><th>Price</th><th>Quantity</th><th>Subtotal</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="total-row">Total: ${formatPrice(cartTotal(cart))}</div>
    <p style="text-align:right;"><a class="btn btn-green" href="checkout.html">Proceed to Checkout</a></p>`;
}

// Set a new quantity for a book (never above stock, never below 1)
function setQuantity(bookId, newQty) {
  const cart = getCart();
  const item = cart.find((i) => i.bookId === bookId);
  if (!item) return;

  newQty = parseInt(newQty, 10);
  if (isNaN(newQty) || newQty < 1) newQty = 1;

  if (newQty > item.stock) {
    newQty = item.stock;
    showMessage('message', `Only ${item.stock} copies of "${item.title}" are in stock`, 'error');
  } else {
    document.getElementById('message').className = 'message'; // hide old message
  }

  item.quantity = newQty;
  saveCart(cart);
  renderCart();
}

function removeItem(bookId) {
  saveCart(getCart().filter((i) => i.bookId !== bookId));
  renderCart();
}

// Click on +, -, Remove buttons
cartBox.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const id = btn.dataset.id;
  const item = getCart().find((i) => i.bookId === id);
  if (!item) return;

  if (btn.dataset.action === 'inc') setQuantity(id, item.quantity + 1);
  if (btn.dataset.action === 'dec') setQuantity(id, item.quantity - 1);
  if (btn.dataset.action === 'remove') removeItem(id);
});

// Typing a quantity directly
cartBox.addEventListener('change', (e) => {
  if (e.target.classList.contains('qty-input')) {
    setQuantity(e.target.dataset.id, e.target.value);
  }
});

// Start: sync with the database, then draw
(async function init() {
  cartBox.innerHTML = '<p class="center muted">Loading cart...</p>';
  await syncCart();
  renderCart();
})();