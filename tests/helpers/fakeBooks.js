// tests/helpers/fakeBooks.js - makes a mocked Book model behave like MongoDB for stock.
// findOneAndUpdate only changes stock when stock >= quantity (like the real conditional update).
function installFakeBooks(Book, books) {
  const find = (id) => books.find((b) => String(b._id) === String(id)) || null;

  Book.findById.mockImplementation(async (id) => find(id));

  Book.findOneAndUpdate.mockImplementation(async (filter, update) => {
    const book = find(filter._id);
    if (!book) return null;
    const needed = filter.stock && filter.stock.$gte !== undefined ? filter.stock.$gte : 0;
    if (book.stock < needed) return null;
    book.stock += update.$inc.stock;
    return book;
  });

  Book.updateOne.mockImplementation(async (filter, update) => {
    const book = find(filter._id);
    if (book) book.stock += update.$inc.stock;
    return { modifiedCount: book ? 1 : 0 };
  });
}

module.exports = { installFakeBooks };
