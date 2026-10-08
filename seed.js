// seed.js - inserts 10 sample books so you can test immediately
// Run with: node seed.js
require('dotenv').config();
const mongoose = require('mongoose');
const Book = require('./models/Book');

// Cover images come from Open Library using each book's ISBN.
// (If a cover does not load, the frontend will show a placeholder.)
function cover(isbn) {
  return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
}

const books = [
  {
    title: 'Clean Code',
    author: 'Robert C. Martin',
    isbn: '9780132350884',
    price: 899,
    category: 'Technology',
    description: 'A handbook of agile software craftsmanship. Learn how to write readable, maintainable code.',
    image: cover('9780132350884'),
    stock: 15,
  },
  {
    title: 'The Pragmatic Programmer',
    author: 'Andrew Hunt, David Thomas',
    isbn: '9780135957059',
    price: 999,
    category: 'Technology',
    description: 'Your journey to mastery. Practical tips for becoming a better, more effective programmer.',
    image: cover('9780135957059'),
    stock: 10,
  },
  {
    title: 'Introduction to Algorithms',
    author: 'Thomas H. Cormen',
    isbn: '9780262046305',
    price: 1499,
    category: 'Technology',
    description: 'The classic textbook covering a broad range of algorithms in depth.',
    image: cover('9780262046305'),
    stock: 8,
  },
  {
    title: 'Atomic Habits',
    author: 'James Clear',
    isbn: '9780735211292',
    price: 499,
    category: 'Self-Help',
    description: 'An easy and proven way to build good habits and break bad ones.',
    image: cover('9780735211292'),
    stock: 25,
  },
  {
    title: 'Sapiens: A Brief History of Humankind',
    author: 'Yuval Noah Harari',
    isbn: '9780062316097',
    price: 599,
    category: 'History',
    description: 'A sweeping history of the human species, from the Stone Age to today.',
    image: cover('9780062316097'),
    stock: 12,
  },
  {
    title: 'The Alchemist',
    author: 'Paulo Coelho',
    isbn: '9780062315007',
    price: 299,
    category: 'Fiction',
    description: 'A shepherd boy named Santiago travels in search of a worldly treasure.',
    image: cover('9780062315007'),
    stock: 30,
  },
  {
    title: '1984',
    author: 'George Orwell',
    isbn: '9780451524935',
    price: 349,
    category: 'Fiction',
    description: 'A dystopian novel about surveillance, control and the power of truth.',
    image: cover('9780451524935'),
    stock: 20,
  },
  {
    title: 'To Kill a Mockingbird',
    author: 'Harper Lee',
    isbn: '9780061120084',
    price: 399,
    category: 'Fiction',
    description: 'A story of racial injustice and childhood innocence in the American South.',
    image: cover('9780061120084'),
    stock: 14,
  },
  {
    title: 'The Hobbit',
    author: 'J.R.R. Tolkien',
    isbn: '9780547928227',
    price: 450,
    category: 'Fantasy',
    description: 'Bilbo Baggins joins a group of dwarves on a quest to reclaim their treasure from a dragon.',
    image: cover('9780547928227'),
    stock: 18,
  },
  {
    title: 'Wings of Fire',
    author: 'A.P.J. Abdul Kalam',
    isbn: '9788173711466',
    price: 250,
    category: 'Biography',
    description: 'The autobiography of Dr. A.P.J. Abdul Kalam, India\'s Missile Man and former President.',
    image: cover('9788173711466'),
    stock: 22,
  },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    await Book.deleteMany({});            // remove old books so seeding is repeatable
    await Book.insertMany(books);         // insert the sample books

    console.log(`Seeded ${books.length} books successfully`);
  } catch (err) {
    console.error('Seeding failed:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

seed();