// book.js - show one book (id comes from the URL: book.html?id=...)

const bookId = new URLSearchParams(window.location.search).get('id');
const detailBox = document.getElementById('bookDetail');

async function loadBook() {
  if (!bookId) {
    detailBox.innerHTML = '<p>No book selected.</p>';
    return;
  }

  try {
    const book = await api('/api/books/' + bookId);

    detailBox.innerHTML = `
      <div class="book-detail">
        ${imgTag(book.image, book.title)}
        <div class="book-info">
          <h1>${escapeHtml(book.title)}</h1>
          <p class="muted">by ${escapeHtml(book.author)}</p>
          <p class="price">${formatPrice(book.price)}</p>
          <p><strong>Category:</strong> ${escapeHtml(book.category)}</p>
          <p><strong>ISBN:</strong> ${escapeHtml(book.isbn)}</p>
          <p><strong>Stock:</strong>
            ${book.stock > 0
              ? `<span class="badge badge-ok">${book.stock} available</span>`
              : '<span class="badge badge-out">Out of stock</span>'}
          </p>
          <p>${escapeHtml(book.description)}</p>
          <button class="btn btn-green" id="addBtn" ${book.stock < 1 ? 'disabled' : ''}>
            Add to Cart
          </button>
        </div>
      </div>`;

    document.getElementById('addBtn').addEventListener('click', () => {
      const result = addToCart(book);
      showMessage('message', result.message, result.ok ? 'success' : 'error');
    });
  } catch (err) {
    detailBox.innerHTML = '';
    showMessage('message', err.message, 'error');
  }
}

loadBook();