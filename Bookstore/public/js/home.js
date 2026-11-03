// home.js - list, search and filter books

const searchInput = document.getElementById('searchInput');
const categorySelect = document.getElementById('categorySelect');
const bookGrid = document.getElementById('bookGrid');

// Fill the category dropdown from the database
async function loadCategories() {
  try {
    const categories = await api('/api/books/categories/list');
    categories.forEach((cat) => {
      const option = document.createElement('option');
      option.value = cat;
      option.textContent = cat;
      categorySelect.appendChild(option);
    });
  } catch (err) {
    showMessage('message', err.message, 'error');
  }
}

// Fetch books (using the current search text + category) and draw them
async function loadBooks() {
  try {
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set('search', searchInput.value.trim());
    if (categorySelect.value !== 'All') params.set('category', categorySelect.value);

    const books = await api('/api/books?' + params.toString());

    if (books.length === 0) {
      bookGrid.innerHTML = '<p class="muted">No books found.</p>';
      return;
    }

    bookGrid.innerHTML = books
      .map(
        (book) => `
        <div class="book-card">
          ${imgTag(book.image, book.title)}
          <h3>${escapeHtml(book.title)}</h3>
          <div class="author">by ${escapeHtml(book.author)}</div>
          <div class="price">${formatPrice(book.price)}</div>
          <div>
            ${book.stock > 0
              ? `<span class="badge badge-ok">In stock (${book.stock})</span>`
              : '<span class="badge badge-out">Out of stock</span>'}
          </div>
          <a class="btn" href="book.html?id=${book._id}">View Details</a>
        </div>`
      )
      .join('');
  } catch (err) {
    showMessage('message', err.message, 'error');
  }
}

// Search while typing (waits 300ms after the last key press)
let timer;
searchInput.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(loadBooks, 300);
});
categorySelect.addEventListener('change', loadBooks);

loadCategories();
loadBooks();