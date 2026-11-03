# PROJECT_HANDOFF.md - Bookstore college assignment

## Status
| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Coupons (OBIM-15): models, server-side validation, checkout integration, admin management | DONE, 104/104 tests pass |
| 2 | Inventory: atomic stock, out-of-stock handling, restock on cancel/refund (OBIM-11) | CODE + TESTS WRITTEN, NEVER RUN (see Phase 2 section) |
| 3 | Customer order history and order details, enforced authorization (OBIM-9) | CODE + TESTS WRITTEN, JEST NOT RUN (no network; see Phase 3 section) |
| 4 | Sales and inventory reports dashboard (OBIM-12) | CODE WRITTEN; automated tests NOT run; not verified |
| 5 | Order confirmation email, dev-mode preview (OBIM-8) | CODE WRITTEN; automated tests NOT run; real SMTP delivery NOT verified |

## Phase 1 - completed work

### Fixes made to existing code that Phase 1 depended on
- **Login now returns a signed token.** `routes/auth.js` returns `token` (JWT, 8h, contains `id` and `role`). Before this, `requireAuth` could never succeed for the browser, so the existing admin Add Book page was returning 401 too. `public/js/login.js` stores it; `common.js` sends it as `Authorization: Bearer` on every API call.
- **`User` has a `role` field** (`customer` | `admin` | `staff`, default `customer`). Before this, `createAdmin.js` set a role that Mongoose silently dropped.
- **`server.js` refuses to start without `JWT_SECRET`.**
- **`tests/books.test.js` now sends an admin token** on POST requests. It was failing (10 tests) before any Phase 1 change because the route already required auth.
- **`tests/auth.test.js`** sets a test `JWT_SECRET`.

### New files
- `models/Coupon.js` - code (unique, upper case), type (percentage|fixed), value, minPurchase, maxDiscount, validFrom, validUntil, usageLimit, usedCount, active.
- `services/coupon.js` - `evaluateCoupon()` pure rules: not found, inactive, not yet valid, expired, usage limit, minimum purchase, percentage with cap, fixed capped at subtotal, rounding to 2 decimals.
- `services/pricing.js` - `priceCart(items)`: prices from the DATABASE and checks stock. Used by orders and coupon preview, so the rules and messages are shared.
- `routes/coupons.js`
  - `POST /api/coupons/validate` (public): body `{ items, couponCode }`, returns subtotal, discount, total.
  - `GET /api/coupons`, `POST /api/coupons`, `PUT /api/coupons/:id`, `PATCH /api/coupons/:id/status` (admin or staff only).
- `public/admin-coupons.html`, `public/js/admin-coupons.js` - create, edit, activate/deactivate coupons.
- `tests/coupon.test.js` - rule tests and route tests (access control, validation).
- `tests/orders-coupon.test.js` - discount on orders, browser discount ignored, expired/limit rejection, coupon use returned on failure.
- `.env.example`

### Changed files
- `routes/orders.js` - rewritten to use `priceCart`, accepts `couponCode`, computes the discount on the server, reserves one coupon use atomically (`findOneAndUpdate` with `usedCount < usageLimit`), and gives it back if the order fails to save. Response now includes `subtotal`, `discount`, `total`.
- `models/Order.js` - added `subtotal`, `couponCode`, `discountAmount`. `total` remains the final amount paid.
- `public/checkout.html`, `public/js/checkout.js` - coupon box with Apply/Remove, summary shows subtotal, discount, total payable. The server result is shown; the server recalculates on order.
- `public/js/common.js` - `api()` adds the token; `sendJSON()`; `getToken()`/`setToken()`; logout clears the token; navbar link to Coupons.
- `public/css/style.css` - appended coupon, summary and responsive rules.
- `server.js` - mounts `/api/coupons`; JWT_SECRET check.

## Test results
`npx jest --forceExit`: 7 suites, 104 tests, all passing.
- Pre-existing `test.failing` cases in books.test.js still behave as documented (non-numeric price, ISBN trimming).
- Jest prints "did not exit one second after the test run" without `--forceExit`. This is a mongoose/open-handle warning in the test setup, not a failing test.
- Not run: the live server against real MongoDB (no MongoDB in the environment). Manual browser testing is still needed (see demo steps in the final report).

## Modified files list (Phase 1)
models/User.js, models/Order.js, models/Coupon.js (new), routes/auth.js, routes/orders.js, routes/coupons.js (new), services/coupon.js (new), services/pricing.js (new), server.js, public/js/common.js, public/js/login.js, public/js/checkout.js, public/checkout.html, public/admin-coupons.html (new), public/js/admin-coupons.js (new), public/css/style.css, tests/auth.test.js, tests/books.test.js, tests/coupon.test.js (new), tests/orders-coupon.test.js (new), .env.example (new), PROJECT_HANDOFF.md (new)

## Phase 2 - Inventory (code written, tests NOT yet run)

**IMPORTANT FIRST STEP next session:** the Phase 2 session had no network, so `npm install` failed and Jest could not run. Run `npm install` then `npx jest --forceExit`. Expect 8 suites (7 old + `tests/inventory.test.js`). Fix any failures before starting Phase 3. Only a dependency-free smoke check of `services/inventory.js` was run (two buyers for the last copy, multi-book rollback, restore: all behaved correctly). Syntax of every changed file was checked with `node --check`.

### What was built
- `services/inventory.js` (new)
  - `reserveStock(lines)`: per book `Book.findOneAndUpdate({ _id, stock: { $gte: qty } }, { $inc: { stock: -qty } })`. If any book fails, earlier books are put back and a 400 `StockError` is thrown ("X is out of stock" / "Only N copy/copies of X are in stock").
  - `addStock(entries)`: `$inc` stock back; all-or-nothing (partial restores are undone if a later one fails).
- `routes/orders.js`
  - Checkout: `priceCart` still validates stock first (friendly early error), then `reserveStock` does the atomic take. If `Order.create` (or anything after the take) fails, stock is given back; the coupon use is still given back as in Phase 1. Coupon logic is unchanged.
  - NEW `PATCH /api/orders/:id/status` (admin/staff). Body `{ status: "Cancelled" | "Refunded" }`.
    - The order is "claimed" with ONE conditional update (`status` in Placed/missing AND `stockRestored` not true) that also sets `stockRestored: true`. Only the request that wins the claim restores stock, so double clicks and simultaneous requests cannot restore twice.
    - If the stock restore fails, the claim is undone (order back to Placed) so it can be retried.
    - Cancelled -> Refunded is allowed and does NOT restore stock again. Refunded orders cannot change. Orders created before Phase 2 (no status field) count as Placed.
- `routes/books.js`: NEW `PATCH /api/books/:id/stock` (admin/staff), body `{ stock: <whole number >= 0> }`, one atomic `$set`. Lets an admin mark a book out of stock or restock it.
- `models/Order.js`: added `status` (Placed|Cancelled|Refunded, default Placed), `stockRestored`, `stockRestoredAt`, `statusChangedAt`.
- Storefront: no change needed. `book.js` already disables Add to Cart at stock 0, `common.js addToCart` refuses out-of-stock, `cart.js` drops sold-out items, `home.js` shows the Out of stock badge. Checkout shows the server's stock message.

### Tests
- NEW `tests/inventory.test.js`: atomic filter used, out-of-stock rejected, race (stock vanishes after the check), two buyers for the last copy, multi-book rollback, stock returned when order save fails, coupon use returned on stock failure, coupon order still works, cancel/refund access control (401/403/400/404), stock restored once, duplicate and concurrent cancel, Cancelled->Refunded, Refunded locked, legacy order without status, restore failure (full and partial), admin stock route validation.
- NEW `tests/helpers/fakeBooks.js`: makes a mocked Book behave like conditional MongoDB updates.
- UPDATED `tests/orders.test.js` and `tests/orders-coupon.test.js`: Book mock now has `findOneAndUpdate`/`updateOne` (via the helper); assertions changed from `book.save()` to the atomic update.

### Phase 2 changed files
services/inventory.js (new), routes/orders.js, routes/books.js, models/Order.js, tests/inventory.test.js (new), tests/helpers/fakeBooks.js (new), tests/orders.test.js, tests/orders-coupon.test.js, PROJECT_HANDOFF.md

### Not done / notes for later
- No admin UI yet for cancelling/refunding orders or editing stock; the endpoints exist (call with an admin token). Phase 3 (order details) or a small admin page can add buttons. There is also no `GET` list of all orders for admins yet.
- Cancelling does NOT give back a coupon use (not requested; coupon system left untouched).
- Not tested against a real MongoDB; the conditional-update behaviour is simulated in mocks.

## Phase 3 - Customer order history (code written; Jest NOT run)

**IMPORTANT FIRST STEP next session:** this sandbox had no network, `npm install` left empty module folders, so **Jest, supertest and express could not run**. Phase 2 AND Phase 3 tests have therefore never been executed. Run `npm install` then `npx jest --forceExit`. Expect 9 suites (7 Phase 1 + `inventory` + `order-history`). Fix failures before Phase 4. Do not mark Phase 2 or 3 DONE until this passes.

### What was built
- `routes/orders.js`
  - NEW `GET /api/orders/mine` (login required): the logged-in customer's orders, newest first. User comes only from `req.user.id` (verified JWT). Admin/staff tokens get their OWN orders only.
  - NEW `GET /api/orders/:id` (login required): looks up `{ _id, user: req.user.id }`. Invalid id -> 400 `Invalid order id`; missing OR someone else's order -> 404 `Order not found` (same answer, so it does not reveal that another customer's order exists). Admin/staff get 404 for customer orders here too.
  - Both return a safe view (`toOrderView`): id, createdAt, status (missing status shown as Placed), items (bookId, title, price, quantity, lineTotal), subtotal (falls back to sum of items for old orders), couponCode, discountAmount, total, paymentStatus, shippingAddress. Internal fields (stockRestored etc.) are not sent.
  - CHANGED `POST /api/orders` now needs login (`requireAuth`) and uses `req.user.id`. A `userId` in the body is not needed; if present and different from the token user -> 403. Coupon, stock and rollback logic untouched. (Resolves known limitation 1.)
- Frontend (existing plain HTML/JS architecture)
  - NEW `public/orders.html` + `public/js/orders.js`: order cards with date, status badge, item table, subtotal, coupon discount, total, View details link. Loading, empty ("You have not placed any orders yet" + Browse Books), error with Try again, redirect to login when not logged in or session expired.
  - NEW `public/order-details.html` + `public/js/order-details.js`: full order plus shipping address; error state for bad/other-customer order ids; redirects to login (keeps `?id=`).
  - `public/js/common.js`: "Order History" link in the navbar (shown when logged in).
  - `public/js/login.js`: the `next` redirect now also allows `order-details.html?id=<24 hex>`.
  - `public/js/checkout.js`: no longer sends `userId`.
  - `public/css/style.css`: order card/responsive rules appended.

### Tests (written, NOT run under Jest)
- NEW `tests/order-history.test.js`: list own orders (order, shape, no internal fields, legacy order), token-only identity (query `userId` ignored, admin sees own only), no orders -> empty list, 401 for missing/forged/malformed token, detail for owner, other customer's order -> 404 with no leak, admin/staff -> 404, invalid ids (400), nonexistent id (404), `/mine` not treated as an id, DB errors -> 500, POST uses token user / mismatched userId -> 403, plus coupon discount + atomic stock, out-of-stock rejection, and admin-only cancel with stock restore still working.
- UPDATED to send a JWT on `POST /api/orders` (helper functions only): `tests/orders.test.js`, `tests/orders-coupon.test.js`, `tests/inventory.test.js`.
- What WAS actually run: `node --check` on every JS file (all pass), and a dependency-free smoke script (stubbed express/mongoose/jwt/models, not part of the repo) that called the new handlers: 11/11 checks passed (401s, own orders only, empty list, 400 invalid id, 404 missing, 404 for other customer and for admin, route order `/mine` before `/:id`). This is NOT a substitute for the Jest run. Frontend pages were not opened in a browser.

### Phase 3 changed files
routes/orders.js, public/orders.html (new), public/order-details.html (new), public/js/orders.js (new), public/js/order-details.js (new), public/js/common.js, public/js/login.js, public/js/checkout.js, public/css/style.css, tests/order-history.test.js (new), tests/orders.test.js, tests/orders-coupon.test.js, tests/inventory.test.js, PROJECT_HANDOFF.md

### Remaining issues
- Jest never run for Phase 2 or 3 (see first step). Likely failure spots if any: mock shapes in `order-history.test.js` (`Order.find().sort().lean()` chain).
- Existing browser sessions: old localStorage logins without a token can no longer check out (401); log in again.
- No admin UI for orders yet (cancel/refund endpoint only); an admin "all orders" list is not built.
- Not tested against real MongoDB or in a browser. Manual check: register, order (with and without coupon), open Order History and details; try another customer's order id in the URL (expect "Order not found"); cancel via admin API and confirm status changes.

### Exact next steps
1. `npm install`, `npx jest --forceExit`, fix any failures, record real counts here.
2. Manual browser demo of the steps above.
3. Phase 4 (OBIM-12): sales and inventory reports dashboard (admin/staff only).

## Phase 4 - Sales and inventory reports (code written; NOT tested or verified)

**Automated tests were NOT run** (no Jest, no npm test, no npm install, per instructions). Only `node --check` syntax checks were run on the new/modified JS files (all passed). The endpoints were never executed against MongoDB and the dashboard was never opened in a browser. Phase 2 and 3 Jest runs are still outstanding (see those sections).

### Features implemented
- `GET /api/reports/sales?from=&to=&limit=` (admin/staff only): revenue, total orders, completed orders, cancelled orders, refunded orders, books sold, best sellers (title, quantity sold, sales before coupons). Uses MongoDB aggregation on `Order`.
- `GET /api/reports/inventory?threshold=5` (admin/staff only): total titles, units in stock, stock value (price x stock), low-stock and out-of-stock counts plus book lists (lists capped at 200 each, counts are exact). Uses aggregation/queries on `Book`.
- Auth: `requireAuth` + `requireRole('admin','staff')` on the whole router (401 no/invalid token, 403 customers).
- Dashboard `public/admin-reports.html`: date filter (From/To, Clear), low-stock threshold, stat cards, best-seller table, low/out-of-stock tables; loading, error (including not logged in / no permission) and empty states; responsive CSS.

### Definitions used
- **Actual sales / completed orders / books sold** = orders with status `Placed` (or no status, for old orders). Cancelled and Refunded orders are excluded from revenue and books sold, and are shown as separate counts. Total orders = all orders in the date range.
- **Revenue** = sum of order `total` (amount paid, after coupon discount).
- Best-seller "sales" = price x quantity per line BEFORE coupon discount (coupons are order-level), so it will not add up to revenue when coupons are used.
- Date filter applies to `createdAt`. The browser sends the local start/end of the chosen days as ISO times; plain `YYYY-MM-DD` sent directly to the API is read as UTC. Inventory is always current and ignores dates.
- Low stock = stock from 1 up to the threshold (default 5). Out of stock = 0.

### Files
Created: `routes/reports.js`, `public/admin-reports.html`, `public/js/admin-reports.js`
Modified: `server.js` (mounts `/api/reports`), `public/js/common.js` (navbar "Reports" link), `public/css/style.css` (appended report styles), `PROJECT_HANDOFF.md`
No test file was added for Phase 4.

### Assumptions / known limitations
- Best sellers use the title stored on the order, grouped by book id.
- Books deleted after being sold still appear in best sellers (from order data).
- Best sellers limit defaults to 10 (max 50 via `limit`; the UI does not expose it).
- No CSV export, charts or per-day breakdown.
- The page has no login screen of its own; log in first at `login.html` as admin/staff.

### How to open and use
1. Set up `.env` (MONGO_URI, JWT_SECRET), run `npm install` and `npm start` (or `node server.js`) yourself.
2. Log in as an admin/staff user (`createAdmin.js` creates one).
3. Open `http://localhost:3000/admin-reports.html` or click "Reports" in the navbar.
4. Choose From/To dates and click Apply, or Clear dates for all time. Change the low-stock threshold if needed.
5. Manual check suggested: place orders, cancel one via `PATCH /api/orders/:id/status`, and confirm revenue and counts update accordingly; confirm a customer login gets "You do not have permission" on the page.

### Next
Phase 5 (OBIM-8): order confirmation email. Still pending first: `npm install`, `npx jest --forceExit`, fix Phase 2/3 failures.

## Phase 5 - Order confirmation email (code written; NOT tested or verified)

**Automated tests were NOT run** (no Jest, no npm test, no npm install). Only `node --check` on changed JS files, plus one dependency-free script that built a preview email from a fake order (it ran in preview mode, and confirmed HTML escaping). Nodemailer was never installed here, so **no real Gmail send was ever attempted**.

### What was built
- `services/email.js` (new): `buildOrderEmail` (subject, text, HTML) and `sendOrderConfirmation(order, user)`, which never throws and returns `sent | preview | failed | skipped`.
  - Email contains: order ID, date (IST), customer name, each book with quantity, unit price and line total, subtotal, coupon code and discount (only when used), final total, order status, shipping address.
  - **Real mode** (both `EMAIL_USER` and `EMAIL_APP_PASSWORD` set): Nodemailer over `smtp.gmail.com:465` (SSL), with timeouts. `sent` is returned only if the server's response lists the customer's address under `accepted` and `rejected` is empty. Anything else is `failed`.
  - **Preview mode** (credentials missing): writes `email-previews/order-<id>.html` and returns `preview`. Nothing is sent and nothing claims it was.
  - `skipped` when the user has no email or when `NODE_ENV=test` (so Jest never writes files or opens connections).
  - Nodemailer is `require`d only when really sending, so the app and existing tests load even without it installed.
  - Credentials are read only from environment variables, are not in any frontend file, and are not logged (failures log only the error code).
- `routes/orders.js`: after `Order.create` succeeds, `sendOrderConfirmation` is called in its own try/catch, then the result is recorded with `Order.updateOne`. The order response now includes `emailStatus`. Email failure cannot undo the order, restore stock or the coupon use, and the email is attempted once per order (no retry loop, so no duplicate sends).
- `models/Order.js`: new fields `emailStatus`, `emailAttemptedAt`, `emailSentAt` (set only for `sent`).
- `public/js/checkout.js`: success card shows an honest line: sent / preview (no email sent) / failed (order saved).
- `package.json`: added `nodemailer ^6.9.14`. `package-lock.json` was NOT updated (no install allowed); `npm install` will update it.
- `.env.example`: `EMAIL_USER`, `EMAIL_APP_PASSWORD`. `.gitignore`: `email-previews/`.

### Files
Created: `services/email.js`. Modified: `routes/orders.js`, `models/Order.js`, `public/js/checkout.js`, `package.json`, `.env.example`, `.gitignore`, `PROJECT_HANDOFF.md`. No tests were added or changed.

### Setup
1. `npm install` (adds Nodemailer).
2. For real email: turn on 2-Step Verification on the Gmail account, create an App Password (Google Account > Security > App passwords), and put `EMAIL_USER=you@gmail.com` and `EMAIL_APP_PASSWORD=<16-char app password>` in `.env`. Never commit `.env`.
3. For preview mode: leave both blank. Place an order and open `email-previews/order-<id>.html` in a browser.
4. Restart the server after editing `.env`.

### Limitations
- The email is sent while the checkout request waits (up to ~10-15s if Gmail is slow); no background queue or retry. A `failed` email is recorded but not retried automatically.
- Order status is always `Placed` in this email because it is sent at creation. Cancel/refund does not send an email.
- Gmail limits daily sends for personal accounts. `accepted` means the SMTP server took the message, not that it reached the inbox.
- The existing Jest order tests were written before this change; with `NODE_ENV=test` the email step is skipped, but they were not run, so this is unverified. The `Order.updateOne` call may not exist on their mocks; it is wrapped in try/catch, so it should not fail an order.
- Not tested with a real MongoDB, real SMTP, or a browser.

### Next
First: `npm install`, `npx jest --forceExit`, fix any failures (Phases 2, 3 and 5 are unrun), then a manual demo in preview mode and with a real App Password.

## Known limitations carried into later phases
1. ~~`POST /api/orders` took `userId` from the body~~ Fixed in Phase 3 (uses the JWT; mismatch -> 403).
2. ~~Stock reduced with `book.save()`~~ Fixed in Phase 2 (atomic conditional updates with rollback).
3. ~~Order.create failure did not restore stock~~ Fixed in Phase 2.
4. The coupon preview does not reserve a use; two customers can both preview the last use, but only one order succeeds (intended).
5. Admin pages are protected by the API. The page itself has no login screen; it shows an error if the token is missing or the role is wrong.
6. Coupon `usedCount` is only incremented on successful order creation, and decremented only if the order save throws in the same request.
7. Changing a coupon's code or value does not affect existing orders (order stores its own discount).

## Exact continuation instructions
1. `npm install`, then `npx jest --forceExit`. Fix any Phase 2 test failures first (Phase 2 tests were never executed). Then mark Phase 2 DONE here with the real pass count.
2. Phase 3 (OBIM-9): customer order history/details. Take the user from the JWT (`req.user.id`) in `POST /api/orders` and reject a mismatching `userId`; add `GET /api/orders/mine` and `GET /api/orders/:id` (owner or admin only). Show order `status` in the details. Optionally add admin Cancel/Refund buttons using `PATCH /api/orders/:id/status`.
3. Update this file before stopping.
