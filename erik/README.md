# HNM Atelier

A considered fashion and lifestyle storefront with a separate product and order studio.

## MongoDB setup

1. Install Node.js and run `npm install` in this folder.
2. Copy `.env.example` to `.env`.
3. Configure `MONGODB_URI` and `MONGODB_DB` in `.env`.
   - Local MongoDB: keep `mongodb://127.0.0.1:27017` and ensure the MongoDB service is running.
   - MongoDB Atlas: paste your cluster connection string into `MONGODB_URI`, replace the database user/password placeholders, and allow your server IP in Atlas Network Access.
4. Set a private `ADMIN_EMAIL` and a unique password of at least 12 characters in `.env`.
5. Set `SESSION_SECRET` to a random secret generated locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
6. Run `npm start` and open `http://localhost:8000`.

Keep `.env` private: it contains database, admin, and payment credentials and is excluded from Git. **Never send secrets in chat.** If the database password has been shared, rotate it in Atlas and update `.env` before using the store. The app creates the `hnm_store` database and validates its `products`, `orders`, `payment_attempts`, `store_settings`, `customers`, and session collections on startup. It seeds the initial catalog and homepage settings when those collections are empty.

- Storefront: `index.html`
- Separate admin page: `http://localhost:8000/admin`
- Database health check: `http://localhost:8000/api/health`

Product name, department, category, price, per-product discount (0–100%), stock quantity, badge, and up to four product images can be managed from the separate admin panel. Upload JPEG, PNG, or WebP product photos directly (up to 8 MB each), or provide image URLs. Homepage hero banner slides can also be uploaded or changed by URL in the Storefront settings. Uploaded image files are stored in `assets/products`; their references and product details are validated and saved through the admin panel. Admin sign-in uses a MongoDB-backed session cookie. Customers can create an account and sign in with a unique email address or phone number and a password of at least 12 characters. Passwords are bcrypt-hashed, and customer sessions are stored in MongoDB; “Remember me” extends a customer session to 30 days. Wishlists require an account and are saved to the customer profile. Password-reset emails and email verification are not configured. Product checkout uses WatchPays and redirects customers to its hosted payment page. Set the documented `WATCHPAYS_CREATE_URL`, your `WATCHPAYS_MERCHANT_ID`, and `WATCHPAYS_API_KEY` in the private `.env`; local development can use `http://localhost:8000/api/payments/watchpays/callback` as the callback URL. In production, set `WATCHPAYS_CALLBACK_URL` to the public HTTPS callback URL for this site. WatchPays callbacks are unsigned, so they are recorded as unverified and never automatically mark an order paid. Before confirming an attempt, an admin must verify the exact payment and amount in the WatchPays merchant dashboard, then use “Verify in WatchPays & create order” in the protected orders panel. This step reserves inventory and creates the paid order. Cancelling a confirmed order restores its stock; reopening it reserves stock again.

The storefront includes Ladies, Home, and Beauty departments, with separate starter products, department filtering, and a three-image hero slideshow that advances from right to left. Men and Kids departments and catalog products have been removed; historical order records are retained. Product and department images, prices (INR), discounts, stock, names, and types are editable in the separate admin panel. The Atelier theme respects reduced-motion preferences.

WatchPays checkout uses the documented live create endpoint (`https://api.watchpays.com/v1/create`) and an MD5 signature over the sorted amount, callback URL, merchant ID, and merchant order number parameters. The guide does not provide a sandbox endpoint. Do not test with live funds unless your WatchPays account is configured for safe testing. The browser redirect and unsigned callback are not proof of payment; verify each payment in the merchant dashboard before confirming it in admin.
