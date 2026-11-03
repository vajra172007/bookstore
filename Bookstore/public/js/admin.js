// admin.js - add a new book to the database

document.getElementById('bookForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const book = {
    title: document.getElementById('title').value.trim(),
    author: document.getElementById('author').value.trim(),
    isbn: document.getElementById('isbn').value.trim(),
    price: document.getElementById('price').value,
    category: document.getElementById('category').value.trim(),
    stock: document.getElementById('stock').value,
    image: document.getElementById('image').value.trim(),
    description: document.getElementById('description').value.trim(),
  };

  try {
    const data = await postJSON('/api/books', book);
    showMessage('message', data.message, 'success');
    e.target.reset(); // clear the form for the next book
  } catch (err) {
    showMessage('message', err.message, 'error');
  }
});