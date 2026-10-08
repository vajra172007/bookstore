# Online Bookstore

An Express and MongoDB online bookstore with a browser-based storefront, account registration and login, book search, cart management, checkout, and sample inventory seeding.

## Features

- Browse and search books by title, author, and category
- Register and log in with bcrypt-hashed passwords
- Add books to a browser-local cart with stock limits
- Place orders with server-side price and inventory checks
- Add books to the catalog through the admin endpoint
- Seed the database with ten sample books

## Requirements

- Node.js 20 or newer
- npm
- MongoDB (local or hosted)

## Getting started

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a local environment file:

   ```sh
   copy .env.example .env
   ```

   On macOS or Linux, use `cp .env.example .env` instead.

3. Set `MONGO_URI` in `.env` to a database you can access. The default example uses a local MongoDB database.

4. Load the sample catalog:

   ```sh
   npm run seed
   ```

5. Start the server:

   ```sh
   npm start
   ```

6. Open <http://localhost:3000>.

The server does not start until it has connected to MongoDB.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | HTTP port; defaults to `3000` |
| `MONGO_URI` | Yes | MongoDB connection string |

Never commit `.env` or credentials. Use `.env.example` to document safe defaults and required variables.

## API overview

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/register` | Create a user account |
| `POST` | `/api/login` | Authenticate a user |
| `GET` | `/api/books` | List or search books |
| `GET` | `/api/books/categories/list` | List book categories |
| `GET` | `/api/books/:id` | Get one book |
| `POST` | `/api/books` | Add a book to the catalog |
| `POST` | `/api/orders` | Place an order |

The current checkout uses a simulated payment flow and marks created orders as paid. Authentication is intentionally simple for this sprint and stores the logged-in user in browser local storage; do not use this implementation as-is for production payments or account security.

## Tests

Run the Jest test suite:

```sh
npm test -- --runInBand
```

The test suite covers authentication, order validation, and cart behavior without requiring a live MongoDB instance.

## Project layout

```text
models/       Mongoose schemas
routes/       Express API routes
public/       Storefront HTML, CSS, and browser JavaScript
tests/        Jest tests
server.js     Application entry point
seed.js       Sample catalog seed script
```

## Contributing

Create a focused branch, run the test suite before opening a pull request, and include tests for behavior changes. The GitHub Actions workflow runs the test suite on supported Node.js versions for pushes and pull requests.
