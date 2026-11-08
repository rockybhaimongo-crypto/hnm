require("dotenv").config();

const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const bcrypt = require("bcryptjs");
const connectMongo = require("connect-mongo");
const express = require("express");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const helmet = require("helmet");
const { Int32, MongoClient, ObjectId } = require("mongodb");
const { initialProducts } = require("./store-data");

const PORT = Number(process.env.PORT || 8000);
const DATABASE_NAME = process.env.MONGODB_DB || "hnm_store";
const WATCHPAYS_CREATE_URL = "https://api.watchpays.com/v1/create";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_SESSION_TTL_MS = 60 * 60 * 8 * 1000;
const REMEMBERED_SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const DEFAULT_DISCOUNT_PERCENTAGE = 20;
const MAX_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024;
const PRODUCT_IMAGE_TYPES = new Map([
  ["image/jpeg", { extension: "jpg", signature: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ["image/png", { extension: "png", signature: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
  ["image/webp", { extension: "webp", signature: (buffer) => buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" }]
]);
const DEFAULT_HEADER_CATEGORIES = ["Ladies", "Home", "Beauty"];
const DEFAULT_CATEGORY_IMAGES = [
  "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=800&q=85",
  "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=800&q=85",
  "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=800&q=85"
];
const DEFAULT_SETTINGS = {
  announcement: "FLAT 55% OFF YOUR FAVOURITES | MEMBER EXCLUSIVE",
  heroTitle: "Style, considered.",
  heroSubtitle: "A thoughtfully curated edit for feeling like your most effortless self.",
  heroImage: "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=2200&q=88",
  heroImage2: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=2200&q=88",
  heroImage3: "https://images.unsplash.com/photo-1487222477894-8943e31ef7b2?auto=format&fit=crop&w=2200&q=88",
  campaignBannerImage: "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=1800&q=88",
  headerCategories: DEFAULT_HEADER_CATEGORIES,
  categoryImages: DEFAULT_CATEGORY_IMAGES
};
const VALID_STATUSES = new Set(["Processing", "Shipped", "Delivered", "Cancelled"]);
const VALID_PAYMENT_STATUSES = new Set(["Pending", "Paid"]);
const VALID_CLOTHING_SIZES = new Set(["XS", "S", "M", "L", "XL", "XXL"]);
const VALID_WAIST_SIZES = new Set(["24", "26", "28", "30", "32", "34", "36", "38"]);
const UNAVAILABLE_WAIST_SIZES = new Set(["36", "38"]);
const VALID_ORDER_SIZES = new Set([...VALID_CLOTHING_SIZES, ...VALID_WAIST_SIZES]);

function requiredEnvironment() {
  const missing = ["MONGODB_URI", "ADMIN_EMAIL", "ADMIN_PASSWORD", "SESSION_SECRET"]
    .filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}. Copy .env.example to .env and configure it.`);
  }
  if (process.env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  if (process.env.ADMIN_PASSWORD.length < 12 || Buffer.byteLength(process.env.ADMIN_PASSWORD) > 72) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters and no more than 72 UTF-8 bytes.");
  }
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT must be a valid TCP port.");
  }
}

const productValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["name", "category", "price", "stock", "image", "badge", "createdAt", "updatedAt"],
    properties: {
      _id: { bsonType: "string" },
      name: { bsonType: "string", minLength: 1, maxLength: 70 },
      category: { enum: ["Clothing", "Accessories", "Home", "Beauty"] },
      quickCategory: { enum: ["dresses", "tops", "co-ords", "shirts", "tees", "skirts", "baggy-pants", "sale"] },
      department: { bsonType: "string", maxLength: 24 },
      price: { bsonType: ["double", "int", "long"], minimum: 0.01 },
      discountPercentage: { bsonType: ["int", "long"], minimum: 0, maximum: 100 },
      stock: { bsonType: ["int", "long"], minimum: 0 },
      image: { bsonType: "string", minLength: 1, maxLength: 2048 },
      images: {
        bsonType: "array",
        minItems: 1,
        maxItems: 4,
        items: { bsonType: "string", minLength: 1, maxLength: 2048 }
      },
      badge: { bsonType: "string", maxLength: 18 },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" }
    }
  }
};

const orderValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["customer", "shippingAddress", "items", "subtotal", "discount", "total", "paymentStatus", "status", "createdAt", "updatedAt"],
    properties: {
      _id: { bsonType: "string" },
      customer: {
        bsonType: "object",
        required: ["name", "email", "phone"],
        properties: {
          name: { bsonType: "string", minLength: 1, maxLength: 100 },
          email: { bsonType: "string", maxLength: 254 },
          phone: { bsonType: "string", minLength: 7, maxLength: 25 }
        }
      },
      shippingAddress: {
        bsonType: "object",
        required: ["line1", "city", "region", "postalCode", "country"],
        properties: {
          line1: { bsonType: "string", minLength: 1, maxLength: 150 },
          line2: { bsonType: "string", maxLength: 150 },
          city: { bsonType: "string", minLength: 1, maxLength: 80 },
          region: { bsonType: "string", minLength: 1, maxLength: 80 },
          postalCode: { bsonType: "string", minLength: 2, maxLength: 16 },
          country: { bsonType: "string", minLength: 2, maxLength: 80 }
        }
      },
      items: {
        bsonType: "array",
        minItems: 1,
        maxItems: 50,
        items: {
          bsonType: "object",
          required: ["productId", "name", "unitPrice", "quantity"],
          properties: {
            productId: { bsonType: "string" },
            name: { bsonType: "string", maxLength: 70 },
            unitPrice: { bsonType: ["double", "int", "long"], minimum: 0 },
            discountPercentage: { bsonType: ["int", "long"], minimum: 0, maximum: 100 },
            quantity: { bsonType: ["int", "long"], minimum: 1 },
            size: { enum: [...VALID_ORDER_SIZES] }
          }
        }
      },
      subtotal: { bsonType: ["double", "int", "long"], minimum: 0 },
      discount: { bsonType: ["double", "int", "long"], minimum: 0 },
      total: { bsonType: ["double", "int", "long"], minimum: 0 },
      paymentStatus: { enum: [...VALID_PAYMENT_STATUSES] },
      status: { enum: [...VALID_STATUSES] },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" }
    }
  }
};

const paymentAttemptValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["customer", "shippingAddress", "items", "subtotal", "discount", "total", "status", "createdAt", "updatedAt"],
    properties: {
      _id: { bsonType: "string" },
      customer: orderValidator.$jsonSchema.properties.customer,
      shippingAddress: orderValidator.$jsonSchema.properties.shippingAddress,
      items: orderValidator.$jsonSchema.properties.items,
      subtotal: { bsonType: ["double", "int", "long"], minimum: 0 },
      discount: { bsonType: ["double", "int", "long"], minimum: 0 },
      total: { bsonType: ["double", "int", "long"], minimum: 0 },
      merchantOrderNo: { bsonType: "string", minLength: 1, maxLength: 80 },
      gatewayOrderNo: { bsonType: "string", maxLength: 100 },
      paymentUrl: { bsonType: "string", maxLength: 2048 },
      status: { enum: ["pending", "manually_verified"] },
      unverifiedCallback: {
        bsonType: "object",
        properties: {
          orderNo: { bsonType: "string", maxLength: 100 },
          status: { bsonType: "string", maxLength: 30 },
          amount: { bsonType: ["double", "int", "long"] },
          receivedAt: { bsonType: "date" }
        }
      },
      linkedOrderId: { bsonType: "string", maxLength: 100 },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" }
    }
  }
};

const settingsValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["_id", "announcement", "heroTitle", "heroSubtitle", "updatedAt"],
    properties: {
      _id: { enum: ["homepage"] },
      announcement: { bsonType: "string", maxLength: 110 },
      heroTitle: { bsonType: "string", maxLength: 50 },
      heroSubtitle: { bsonType: "string", maxLength: 120 },
      heroImage: { bsonType: "string", maxLength: 2048 },
      heroImage2: { bsonType: "string", maxLength: 2048 },
      heroImage3: { bsonType: "string", maxLength: 2048 },
      campaignBannerImage: { bsonType: "string", maxLength: 2048 },
      headerCategories: {
        bsonType: "array",
        minItems: 3,
        maxItems: 3,
        items: { bsonType: "string", minLength: 1, maxLength: 24 }
      },
      categoryImages: {
        bsonType: "array",
        minItems: 3,
        maxItems: 3,
        items: { bsonType: "string", minLength: 1, maxLength: 2048 }
      },
      updatedAt: { bsonType: "date" }
    }
  }
};

const customerValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["name", "passwordHash", "createdAt"],
    anyOf: [{ required: ["email"] }, { required: ["phone"] }],
    properties: {
      name: { bsonType: "string", minLength: 2, maxLength: 80 },
      email: { bsonType: "string", minLength: 3, maxLength: 254 },
      phone: { bsonType: "string", minLength: 8, maxLength: 16 },
      passwordHash: { bsonType: "string", minLength: 1, maxLength: 100 },
      createdAt: { bsonType: "date" }
    }
  }
};

async function ensureCollection(db, name, validator) {
  const collections = await db.listCollections({ name }, { nameOnly: true }).toArray();
  if (collections.length === 0) {
    await db.createCollection(name, {
      validator,
      validationLevel: "strict",
      validationAction: "error"
    });
    return;
  }
  await db.command({
    collMod: name,
    validator,
    validationLevel: "strict",
    validationAction: "error"
  });
}

function asProduct(document) {
  if (!document) return null;
  const { _id, ...fields } = document;
  return { id: String(_id), ...fields };
}

function productDiscountPercentage(product) {
  return Number.isInteger(product.discountPercentage)
    ? product.discountPercentage
    : DEFAULT_DISCOUNT_PERCENTAGE;
}

function discountedPrice(price, percentage) {
  return Math.round(price * (1 - percentage / 100) * 100) / 100;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseCustomerIdentifier(value) {
  const identifier = typeof value === "string" ? value.trim() : "";
  if (identifier.includes("@")) {
    const email = identifier.toLowerCase();
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? { email }
      : null;
  }
  const digits = identifier.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15
    ? { phone: `+${digits}` }
    : null;
}

function isProductImageUrl(value) {
  return isWebUrl(value) || /^\/product-images\/[a-zA-Z0-9._-]+$/.test(value);
}

function parseProduct(body, { creating = false, allowedDepartments = DEFAULT_HEADER_CATEGORIES } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const name = cleanText(body.name, 70);
  const category = body.category;
  const department = cleanText(body.department, 24);
  const price = Number(body.price);
  const stock = Number(body.stock);
  const image = cleanText(body.image, 2048);
  const images = Array.isArray(body.images) ? body.images.map((item) => cleanText(item, 2048)) : [image];
  const badge = cleanText(body.badge, 18);
  const discountPercentage = body.discountPercentage === undefined
    ? DEFAULT_DISCOUNT_PERCENTAGE
    : Number(body.discountPercentage);
  const quickCategory = cleanText(body.quickCategory, 16);
  if (!name || !["Clothing", "Accessories", "Home", "Beauty"].includes(category) ||
      !allowedDepartments.includes(department) ||
      !Number.isFinite(price) || price <= 0 ||
      !Number.isSafeInteger(discountPercentage) || discountPercentage < 0 || discountPercentage > 100 ||
      !Number.isSafeInteger(stock) || stock < 0 ||
      !images.length || images.length > 4 || images.some((item) => !isProductImageUrl(item)) ||
      (quickCategory && !["dresses", "tops", "co-ords", "shirts", "tees", "skirts", "baggy-pants", "sale"].includes(quickCategory)) ||
      image !== images[0] || (creating && body.id !== undefined)) {
    return null;
  }
  return {
    name,
    category,
    department,
    price,
    discountPercentage,
    stock: new Int32(stock),
    image,
    images,
    badge,
    ...(quickCategory ? { quickCategory } : {})
  };
}

function parseSettings(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const settings = {
    announcement: cleanText(body.announcement, 110),
    heroTitle: cleanText(body.heroTitle, 50),
    heroSubtitle: cleanText(body.heroSubtitle, 120),
    heroImage: cleanText(body.heroImage, 2048),
    heroImage2: cleanText(body.heroImage2, 2048),
    heroImage3: cleanText(body.heroImage3, 2048),
    campaignBannerImage: cleanText(body.campaignBannerImage, 2048),
    headerCategories: Array.isArray(body.headerCategories)
      ? body.headerCategories.map((category) => cleanText(category, 24))
      : DEFAULT_HEADER_CATEGORIES,
    categoryImages: Array.isArray(body.categoryImages)
      ? body.categoryImages.map((image) => cleanText(image, 2048))
      : DEFAULT_CATEGORY_IMAGES
  };
  if (!settings.announcement || !settings.heroTitle || !settings.heroSubtitle ||
      (settings.heroImage && !isHeroImageUrl(settings.heroImage)) ||
      (settings.heroImage2 && !isHeroImageUrl(settings.heroImage2)) ||
      (settings.heroImage3 && !isHeroImageUrl(settings.heroImage3)) ||
      !isWebUrl(settings.campaignBannerImage) ||
      settings.headerCategories.length !== DEFAULT_HEADER_CATEGORIES.length ||
      settings.headerCategories.some((category) => ["men", "kids"].includes(category.toLowerCase())) ||
      settings.headerCategories.some((category) => !category) ||
      settings.categoryImages.length !== DEFAULT_CATEGORY_IMAGES.length ||
      settings.categoryImages.some((image) => !isWebUrl(image))) return null;
  return settings;
}

function isWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isHeroImageUrl(value) {
  return isWebUrl(value) || /^\/product-images\/[a-zA-Z0-9._-]+$/.test(value);
}

function parseCustomerOrder(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      !body.customer || typeof body.customer !== "object" ||
      !body.shippingAddress || typeof body.shippingAddress !== "object" ||
      !Array.isArray(body.items) || body.items.length === 0 || body.items.length > 20) return null;

  const customer = {
    name: cleanText(body.customer.name, 100),
    email: cleanText(body.customer.email, 254).toLowerCase(),
    phone: cleanText(body.customer.phone, 25)
  };
  const address = body.shippingAddress;
  const shippingAddress = {
    line1: cleanText(address.line1, 150),
    line2: cleanText(address.line2, 150),
    city: cleanText(address.city, 80),
    region: cleanText(address.region, 80),
    postalCode: cleanText(address.postalCode, 16),
    country: cleanText(address.country, 80)
  };
  const normalizedItems = new Map();
  for (const item of body.items) {
    if (!item || typeof item.productId !== "string" ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 20 ||
        (item.size !== undefined && !VALID_ORDER_SIZES.has(item.size))) return null;
    const key = `${item.productId}::${item.size || ""}`;
    const existing = normalizedItems.get(key);
    normalizedItems.set(key, {
      productId: item.productId,
      ...(item.size ? { size: item.size } : {}),
      quantity: (existing?.quantity || 0) + item.quantity
    });
  }
  if (!customer.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) ||
      customer.email.length > 254 || !/^[+()\d\s.-]{7,25}$/.test(customer.phone) ||
      !shippingAddress.line1 || !shippingAddress.city || !shippingAddress.region ||
      !shippingAddress.postalCode || !shippingAddress.country ||
      [...normalizedItems.values()].some((item) => item.quantity > 20)) return null;

  return { customer, shippingAddress, requestedItems: [...normalizedItems.values()] };
}

function loginRequired(req, res, next) {
  if (req.session.admin?.email) return next();
  return res.status(401).json({ error: "Admin sign-in required." });
}

function customerRequired(req, res, next) {
  if (req.session.customer?.email) return next();
  return res.status(401).json({ error: "Create an account or sign in to save your wishlist." });
}

function sameOriginRequest(req, res, next) {
  const origin = req.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.get("host")) {
        return res.status(403).json({ error: "Cross-origin requests are not allowed." });
      }
    } catch {
      return res.status(403).json({ error: "Invalid request origin." });
    }
  }
  return next();
}

function sameOriginJson(req, res, next) {
  if (!req.is("application/json")) {
    return res.status(415).json({ error: "Content-Type must be application/json." });
  }
  return sameOriginRequest(req, res, next);
}

async function start() {
  requiredEnvironment();

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(DATABASE_NAME);
  await Promise.all([
    ensureCollection(db, "products", productValidator),
    ensureCollection(db, "orders", orderValidator),
    ensureCollection(db, "store_settings", settingsValidator),
    ensureCollection(db, "customers", customerValidator),
    ensureCollection(db, "payment_attempts", paymentAttemptValidator)
  ]);

  const products = db.collection("products");
  const orders = db.collection("orders");
  const paymentAttempts = db.collection("payment_attempts");
  const storeSettings = db.collection("store_settings");
  const customers = db.collection("customers");
  const customerIndexes = await customers.listIndexes().toArray();
  if (customerIndexes.some((index) => index.name === "customer_email_unique")) {
    await customers.dropIndex("customer_email_unique");
  }
  await Promise.all([
    customers.createIndex(
      { email: 1 },
      { unique: true, name: "customer_email_unique", partialFilterExpression: { email: { $type: "string" } } }
    ),
    customers.createIndex(
      { phone: 1 },
      { unique: true, name: "customer_phone_unique", partialFilterExpression: { phone: { $type: "string" } } }
    )
  ]);
  await paymentAttempts.createIndex({ createdAt: -1 }, { name: "payment_attempts_created_at" });

  const starterProducts = new Map(initialProducts.map((product) => [product.id, product]));
  const now = new Date();
  for (const [id, department, price] of [
    ["p2", "Ladies", 2899], ["p4", "Ladies", 1599]
  ]) {
    await products.updateOne(
      { _id: id, department: { $exists: false } },
      { $set: { department, price, images: [starterProducts.get(id).image], updatedAt: now } }
    );
  }
  const existingProducts = await products.find(
    { _id: { $in: initialProducts.map((product) => product.id) } },
    { projection: { _id: 1 } }
  ).toArray();
  const existingProductIds = new Set(existingProducts.map((product) => String(product._id)));
  const missingStarterProducts = initialProducts
    .filter((product) => !existingProductIds.has(product.id))
    .map(({ id, ...product }) => ({
      _id: id,
      ...product,
      images: product.images || [product.image],
      stock: new Int32(product.stock),
      createdAt: now,
      updatedAt: now
    }));
  if (missingStarterProducts.length) {
    await products.insertMany(missingStarterProducts, { ordered: true });
  }
  if (!await storeSettings.findOne({ _id: "homepage" })) {
    await storeSettings.insertOne({ _id: "homepage", ...DEFAULT_SETTINGS, updatedAt: new Date() });
  }
  const homepageSettings = await storeSettings.findOne({ _id: "homepage" });
  const retainedCategoryIndexes = (homepageSettings.headerCategories || [])
    .map((category, index) => ({ category, index }))
    .filter(({ category }) => !["men", "kids"].includes(category.trim().toLowerCase()));
  const retainedCategories = retainedCategoryIndexes.length === DEFAULT_HEADER_CATEGORIES.length
    ? retainedCategoryIndexes.map(({ category }) => category)
    : DEFAULT_HEADER_CATEGORIES;
  const retainedCategoryImages = retainedCategoryIndexes.length === DEFAULT_CATEGORY_IMAGES.length
    ? retainedCategoryIndexes.map(({ index }, position) =>
      homepageSettings.categoryImages?.[index] || DEFAULT_CATEGORY_IMAGES[position])
    : DEFAULT_CATEGORY_IMAGES;
  if (JSON.stringify(homepageSettings.headerCategories) !== JSON.stringify(retainedCategories) ||
      JSON.stringify(homepageSettings.categoryImages) !== JSON.stringify(retainedCategoryImages)) {
    await storeSettings.updateOne(
      { _id: "homepage" },
      { $set: { headerCategories: retainedCategories, categoryImages: retainedCategoryImages, updatedAt: new Date() } }
    );
  }
  await storeSettings.updateOne(
    {
      _id: "homepage",
      announcement: {
        $in: [
          "THE DIWALI EDIT · Enjoy 20% off the collection, already reflected in your bag",
          "A LITTLE SOMETHING EXTRA · Enjoy 20% off your edit, applied automatically",
          "A little something extra: complimentary shipping on orders over $120",
          "A LITTLE SOMETHING EXTRA · Special pricing on selected edits, applied automatically"
        ]
      }
    },
    { $set: { announcement: DEFAULT_SETTINGS.announcement } }
  );
  await storeSettings.updateOne(
    {
      _id: "homepage",
      heroTitle: /^Wear it\s+your way\.$/
    },
    { $set: { heroTitle: DEFAULT_SETTINGS.heroTitle } }
  );
  await storeSettings.updateOne(
    {
      _id: "homepage",
      heroSubtitle: "Thoughtful essentials for wherever the day takes you."
    },
    { $set: { heroSubtitle: DEFAULT_SETTINGS.heroSubtitle } }
  );
  await storeSettings.updateOne(
    { _id: "homepage", heroImage: { $exists: false } },
    { $set: { heroImage: DEFAULT_SETTINGS.heroImage } }
  );
  await storeSettings.updateOne(
    { _id: "homepage", heroImage2: { $exists: false } },
    { $set: { heroImage2: DEFAULT_SETTINGS.heroImage2 } }
  );
  await storeSettings.updateOne(
    { _id: "homepage", heroImage3: { $exists: false } },
    { $set: { heroImage3: DEFAULT_SETTINGS.heroImage3 } }
  );
  await storeSettings.updateOne(
    { _id: "homepage", campaignBannerImage: { $exists: false } },
    { $set: { campaignBannerImage: DEFAULT_SETTINGS.campaignBannerImage } }
  );
  await storeSettings.updateOne(
    { _id: "homepage", headerCategories: { $exists: false } },
    { $set: { headerCategories: DEFAULT_HEADER_CATEGORIES } }
  );
  await storeSettings.updateOne(
    { _id: "homepage", categoryImages: { $exists: false } },
    { $set: { categoryImages: DEFAULT_CATEGORY_IMAGES } }
  );

  const adminEmail = process.env.ADMIN_EMAIL.trim().toLowerCase();
  const adminPasswordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
  const customerPasswordDummyHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
  const app = express();
  app.disable("x-powered-by");
  if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"]
      }
    }
  }));
  app.use(express.json({ limit: "16kb" }));
  app.use(session({
    name: "hnm.sid",
    secret: process.env.SESSION_SECRET,
    store: connectMongo.create({
      client,
      dbName: DATABASE_NAME,
      collectionName: "sessions",
      ttl: SESSION_TTL_SECONDS
    }),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: DEFAULT_SESSION_TTL_MS
    }
  }));
  app.use("/product-images", express.static(path.join(__dirname, "assets", "products"), {
    dotfiles: "deny",
    index: false,
    maxAge: "1d"
  }));

  app.get("/api/health", async (_req, res, next) => {
    try {
      await db.command({ ping: 1 });
      res.json({ ok: true, database: DATABASE_NAME });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/storefront", async (_req, res, next) => {
    try {
      const [catalog, homepage] = await Promise.all([
        products.find({}).sort({ createdAt: -1 }).toArray(),
        storeSettings.findOne({ _id: "homepage" })
      ]);
      const { _id: ignoredId, updatedAt: ignoredUpdatedAt, ...settings } = homepage || {};
      res.set("Cache-Control", "no-store");
      res.json({ products: catalog.map(asProduct), settings });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/payments/watchpays", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 12,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many payment attempts. Please wait a few minutes and try again." }
  }), sameOriginJson, async (req, res, next) => {
    const request = parseCustomerOrder(req.body);
    if (!request) return res.status(400).json({ error: "Check your contact, delivery address, and product quantities." });

    const endpoint = process.env.WATCHPAYS_CREATE_URL?.trim();
    const merchantId = process.env.WATCHPAYS_MERCHANT_ID?.trim();
    const apiKey = process.env.WATCHPAYS_API_KEY?.trim();
    const callbackValue = process.env.WATCHPAYS_CALLBACK_URL?.trim();
    let callbackUrl;
    try {
      callbackUrl = new URL(callbackValue);
    } catch {
      return res.status(503).json({ error: "Set a valid WATCHPAYS_CALLBACK_URL in .env before accepting payments." });
    }
    const localCallback = ["localhost", "127.0.0.1", "::1"].includes(callbackUrl.hostname);
    if (endpoint !== WATCHPAYS_CREATE_URL || !merchantId || !apiKey || !callbackValue ||
        !(callbackUrl.protocol === "https:" ||
          (process.env.NODE_ENV !== "production" && callbackUrl.protocol === "http:" && localCallback)) ||
        callbackUrl.username || callbackUrl.password ||
        (process.env.NODE_ENV === "production" && localCallback)) {
      return res.status(503).json({
        error: "WatchPays is not configured. Set WATCHPAYS_CREATE_URL, WATCHPAYS_MERCHANT_ID, WATCHPAYS_API_KEY, and a valid WATCHPAYS_CALLBACK_URL in .env."
      });
    }

    try {
      const orderItems = [];
      for (const requested of request.requestedItems) {
        const product = await products.findOne({ _id: requested.productId });
        if (!product) throw Object.assign(new Error("A selected product is no longer available."), { status: 409 });
        const validSizes = product.quickCategory === "baggy-pants" ? VALID_WAIST_SIZES : VALID_CLOTHING_SIZES;
        if ((product.category === "Clothing" && (!requested.size || !validSizes.has(requested.size))) ||
            (product.quickCategory === "baggy-pants" && UNAVAILABLE_WAIST_SIZES.has(requested.size)) ||
            (product.category !== "Clothing" && requested.size)) {
          throw Object.assign(new Error(`Select a valid size for ${product.name}.`), { status: 400 });
        }
        if (product.stock < requested.quantity) {
          throw Object.assign(new Error(`${product.name} does not have enough stock.`), { status: 409 });
        }
        orderItems.push({
          productId: String(product._id),
          name: product.name,
          unitPrice: Math.round(Number(product.price) * 100) / 100,
          discountPercentage: productDiscountPercentage(product),
          quantity: requested.quantity,
          ...(requested.size ? { size: requested.size } : {})
        });
      }

      const subtotal = Math.round(orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) * 100) / 100;
      const discount = Math.round(orderItems.reduce((sum, item) =>
        sum + (item.unitPrice - discountedPrice(item.unitPrice, item.discountPercentage)) * item.quantity, 0) * 100) / 100;
      const total = Math.round((subtotal - discount) * 100) / 100;
      const amount = total.toFixed(2);
      const merchantOrderNo = `HNM-${crypto.randomUUID().replace(/-/g, "").slice(0, 24).toUpperCase()}`;
      const signatureParams = {
        amount,
        callback_url: callbackUrl.href,
        merchant_id: merchantId,
        merchant_order_no: merchantOrderNo
      };
      const signatureInput = Object.entries(signatureParams)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join("&");
      const signature = crypto.createHash("md5")
        .update(`${signatureInput}&key=${apiKey}`, "utf8")
        .digest("hex");

      let gatewayResponse;
      try {
        const response = await fetch(WATCHPAYS_CREATE_URL, {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...signatureParams,
            api_key: apiKey,
            signature
          }),
          signal: AbortSignal.timeout(15000)
        });
        const responseText = await response.text();
        try {
          gatewayResponse = JSON.parse(responseText);
        } catch {
          console.error("WatchPays returned a non-JSON payment response.");
          return res.status(502).json({ error: "WatchPays returned an unreadable payment response." });
        }
        if (!response.ok) {
          console.error("WatchPays payment creation failed with HTTP status", response.status);
          return res.status(502).json({ error: "WatchPays could not create the payment. Please try again." });
        }
      } catch (error) {
        console.error("WatchPays payment request failed:", error.message);
        return res.status(502).json({ error: "Could not reach WatchPays. Please try again." });
      }

      if (!gatewayResponse || typeof gatewayResponse !== "object" || Array.isArray(gatewayResponse)) {
        console.error("WatchPays returned an invalid payment response.");
        return res.status(502).json({ error: "WatchPays returned payment details that could not be verified." });
      }
      const paymentUrl = typeof gatewayResponse.payment_url === "string" ? gatewayResponse.payment_url : "";
      let parsedPaymentUrl;
      try {
        parsedPaymentUrl = new URL(paymentUrl);
      } catch {
        parsedPaymentUrl = null;
      }
      const amountReturned = Number(gatewayResponse.amount);
      if (gatewayResponse.success !== true ||
          gatewayResponse.merchant_order_no !== merchantOrderNo ||
          typeof gatewayResponse.order_no !== "string" ||
          !gatewayResponse.order_no ||
          gatewayResponse.status !== "created" ||
          !Number.isFinite(amountReturned) ||
          Math.round(amountReturned * 100) !== Math.round(total * 100) ||
          !parsedPaymentUrl || parsedPaymentUrl.protocol !== "https:" ||
          parsedPaymentUrl.username || parsedPaymentUrl.password) {
        console.error("WatchPays returned invalid or mismatched payment details.");
        return res.status(502).json({ error: "WatchPays returned payment details that could not be verified." });
      }

      const now = new Date();
      await paymentAttempts.insertOne({
        _id: merchantOrderNo,
        merchantOrderNo,
        customer: request.customer,
        shippingAddress: request.shippingAddress,
        items: orderItems,
        subtotal,
        discount,
        total,
        gatewayOrderNo: gatewayResponse.order_no,
        paymentUrl,
        status: "pending",
        createdAt: now,
        updatedAt: now
      });
      return res.status(201).json({ paymentUrl, status: "pending" });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  app.get("/api/payments/watchpays/callback", (_req, res) => {
    res.set("Cache-Control", "no-store");
    return res.type("html").send(
      "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Payment status</title><body><main><h1>Thank you for shopping with HNM Atelier</h1><p>Your payment status is being checked. Payment notifications are not considered proof of payment until verified by the store.</p><a href=\"/\">Return to the store</a></main></body></html>"
    );
  });

  app.post("/api/payments/watchpays/callback", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    standardHeaders: "draft-7",
    legacyHeaders: false
  }), async (req, res, next) => {
    const merchantOrderNo = cleanText(req.body?.merchantOrder, 80);
    const gatewayOrderNo = cleanText(req.body?.orderNo, 100);
    const callbackStatus = cleanText(req.body?.status, 30);
    const callbackAmountValue = req.body?.amount;
    const callbackAmountText = typeof callbackAmountValue === "number" || typeof callbackAmountValue === "string"
      ? String(callbackAmountValue)
      : "";
    const callbackAmount = Number(callbackAmountText);
    if (!merchantOrderNo || !gatewayOrderNo ||
        !["success", "failed"].includes(callbackStatus.toLowerCase()) ||
        !/^\d+(?:\.\d{1,2})?$/.test(callbackAmountText) ||
        !Number.isFinite(callbackAmount) || callbackAmount <= 0) {
      return res.status(400).type("text").send("invalid callback");
    }
    try {
      const attempt = await paymentAttempts.findOne({
        _id: merchantOrderNo,
        gatewayOrderNo,
        total: Math.round(callbackAmount * 100) / 100
      }, { projection: { status: 1 } });
      if (!attempt) return res.status(404).type("text").send("payment not found");

      await paymentAttempts.updateOne(
        { _id: merchantOrderNo, status: "pending" },
        {
          $set: {
            unverifiedCallback: {
              orderNo: gatewayOrderNo,
              status: callbackStatus,
              amount: Math.round(callbackAmount * 100) / 100,
              receivedAt: new Date()
            },
            updatedAt: new Date()
          }
        }
      );
      return res.type("text").send("success");
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/admin/session", (req, res) => {
    res.json({ authenticated: Boolean(req.session.admin?.email) });
  });

  app.post(
    "/api/admin/product-images",
    loginRequired,
    sameOriginRequest,
    express.raw({ type: [...PRODUCT_IMAGE_TYPES.keys()], limit: MAX_PRODUCT_IMAGE_BYTES }),
    async (req, res, next) => {
      try {
        const contentType = req.get("content-type")?.split(";")[0].trim().toLowerCase();
        const imageType = PRODUCT_IMAGE_TYPES.get(contentType);
        if (!imageType || !Buffer.isBuffer(req.body) || !req.body.length ||
            !imageType.signature(req.body)) {
          return res.status(400).json({ error: "Upload a valid JPEG, PNG, or WebP image." });
        }
        const filename = `product-${crypto.randomUUID()}.${imageType.extension}`;
        const imageDirectory = path.join(__dirname, "assets", "products");
        await fs.mkdir(imageDirectory, { recursive: true });
        await fs.writeFile(path.join(imageDirectory, filename), req.body, { flag: "wx" });
        return res.status(201).json({ url: `/product-images/${filename}` });
      } catch (error) {
        return next(error);
      }
    }
  );

  app.get("/api/admin/summary", loginRequired, async (_req, res, next) => {
    try {
      const [total, revenueResult] = await Promise.all([
        orders.countDocuments({}),
        orders.aggregate([
          { $match: { status: { $ne: "Cancelled" } } },
          { $group: { _id: null, revenue: { $sum: "$total" } } }
        ]).toArray()
      ]);
      return res.json({ totalOrders: total, revenue: revenueResult[0]?.revenue || 0 });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/account/session", (req, res) => {
    res.set("Cache-Control", "no-store");
    const account = req.session.customer;
    return res.json({
      account: account ? { name: account.name, email: account.email || "", phone: account.phone || "" } : null
    });
  });

  app.get("/api/account/wishlist", customerRequired, async (req, res, next) => {
    try {
      const customer = await customers.findOne(
        { _id: new ObjectId(req.session.customer.id) },
        { projection: { wishlist: 1 } }
      );
      if (!customer) return res.status(401).json({ error: "Sign in again to access your wishlist." });
      res.set("Cache-Control", "no-store");
      return res.json({ productIds: customer.wishlist || [] });
    } catch (error) {
      return next(error);
    }
  });

  app.put("/api/account/wishlist", customerRequired, sameOriginJson, async (req, res, next) => {
    const productIds = req.body?.productIds;
    if (!Array.isArray(productIds) || productIds.length > 100 ||
        productIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 100) ||
        new Set(productIds).size !== productIds.length) {
      return res.status(400).json({ error: "The wishlist must contain up to 100 unique product IDs." });
    }
    try {
      const existingProducts = await products.find(
        { _id: { $in: productIds } },
        { projection: { _id: 1 } }
      ).toArray();
      if (existingProducts.length !== productIds.length) {
        return res.status(400).json({ error: "A wishlist product is no longer available. Refresh and try again." });
      }
      const result = await customers.updateOne(
        { _id: new ObjectId(req.session.customer.id) },
        { $set: { wishlist: productIds, wishlistUpdatedAt: new Date() } }
      );
      if (!result.matchedCount) return res.status(401).json({ error: "Sign in again to save your wishlist." });
      res.set("Cache-Control", "no-store");
      return res.json({ productIds });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/account/register", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many account creation attempts. Try again in 15 minutes." }
  }), sameOriginJson, async (req, res, next) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const identifier = parseCustomerIdentifier(req.body?.identifier);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (name.length < 2 || name.length > 80 || !identifier ||
        Buffer.byteLength(password, "utf8") > 72 || password.length < 12) {
      return res.status(400).json({ error: "Enter a valid name and email or phone number, and a password of at least 12 characters." });
    }
    try {
      const existing = await customers.findOne(identifier, { projection: { _id: 1 } });
      if (existing) return res.status(409).json({ error: "An account with this email or phone number already exists. Sign in instead." });

      const passwordHash = await bcrypt.hash(password, 12);
      const customer = { name, ...identifier, passwordHash, createdAt: new Date() };
      const result = await customers.insertOne(customer);
      await new Promise((resolve, reject) => {
        req.session.regenerate((error) => error ? reject(error) : resolve());
      });
      req.session.customer = { id: String(result.insertedId), name, ...identifier };
      req.session.cookie.maxAge = req.body?.rememberMe === true
        ? REMEMBERED_SESSION_TTL_MS
        : DEFAULT_SESSION_TTL_MS;
      return res.status(201).json({ account: { name, email: identifier.email || "", phone: identifier.phone || "" } });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ error: "An account with this email or phone number already exists. Sign in instead." });
      }
      return next(error);
    }
  });

  app.post("/api/account/login", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Try again in 15 minutes." }
  }), sameOriginJson, async (req, res, next) => {
    const identifier = parseCustomerIdentifier(req.body?.identifier);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!identifier || Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({ error: "Enter a valid email or phone number and password." });
    }
    try {
      const customer = await customers.findOne(identifier);
      const matchesPassword = await bcrypt.compare(password, customer?.passwordHash || customerPasswordDummyHash);
      if (!customer || !matchesPassword) {
        return res.status(401).json({ error: "Email or password is incorrect." });
      }
      await new Promise((resolve, reject) => {
        req.session.regenerate((error) => error ? reject(error) : resolve());
      });
      req.session.customer = {
        id: String(customer._id),
        name: customer.name,
        ...(customer.email ? { email: customer.email } : {}),
        ...(customer.phone ? { phone: customer.phone } : {})
      };
      req.session.cookie.maxAge = req.body?.rememberMe === true
        ? REMEMBERED_SESSION_TTL_MS
        : DEFAULT_SESSION_TTL_MS;
      return res.json({ account: { name: customer.name, email: customer.email || "", phone: customer.phone || "" } });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/account/logout", sameOriginJson, (req, res, next) => {
    if (!req.session.customer) return res.status(204).end();
    delete req.session.customer;
    req.session.cookie.maxAge = DEFAULT_SESSION_TTL_MS;
    req.session.save((error) => {
      if (error) return next(error);
      return res.status(204).end();
    });
  });

  app.post("/api/admin/login", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Try again in 15 minutes." }
  }), sameOriginJson, async (req, res, next) => {
    try {
      const email = cleanText(req.body?.email, 254).toLowerCase();
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const matchesPassword = await bcrypt.compare(password, adminPasswordHash);
      if (email !== adminEmail || !matchesPassword) {
        return res.status(401).json({ error: "Email or password is incorrect." });
      }
      await new Promise((resolve, reject) => {
        req.session.regenerate((error) => error ? reject(error) : resolve());
      });
      req.session.admin = { email: adminEmail };
      return res.json({ authenticated: true });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/admin/logout", loginRequired, sameOriginJson, (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie("hnm.sid", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict"
      });
      return res.status(204).end();
    });
  });

  app.get("/api/admin/orders", loginRequired, async (req, res, next) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const pageSize = 25;
      const [result, total] = await Promise.all([
        orders.find({}).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
        orders.countDocuments({})
      ]);
      res.json({
        orders: result.map(({ _id, ...order }) => ({ id: String(_id), ...order })),
        page,
        pageSize,
        total,
        pages: Math.ceil(total / pageSize)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/payment-attempts", loginRequired, async (_req, res, next) => {
    try {
      const attempts = await paymentAttempts.find({})
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();
      return res.json({
        attempts: attempts.map(({ _id, paymentUrl: _paymentUrl, ...attempt }) => ({
          id: String(_id),
          merchantOrderNo: attempt.merchantOrderNo || String(_id),
          ...attempt
        }))
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/admin/payment-attempts/:id/confirm", loginRequired, sameOriginJson, async (req, res, next) => {
    const mongoSession = client.startSession();
    try {
      let confirmedOrder;
      let issue;
      await mongoSession.withTransaction(async () => {
        const attempt = await paymentAttempts.findOne(
          { _id: req.params.id, status: "pending" },
          { session: mongoSession }
        );
        if (!attempt) {
          issue = { status: 404, message: "Pending payment attempt not found." };
          return;
        }
        for (const item of attempt.items) {
          const reserved = await products.updateOne(
            { _id: item.productId, stock: { $gte: item.quantity } },
            { $inc: { stock: new Int32(-item.quantity) }, $set: { updatedAt: new Date() } },
            { session: mongoSession }
          );
          if (!reserved.modifiedCount) {
            issue = { status: 409, message: `${item.name} does not have enough stock. Do not confirm this payment as fulfilled.` };
            throw Object.assign(new Error(issue.message), { status: issue.status });
          }
        }

        const now = new Date();
        const order = {
          _id: `HNM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          customer: attempt.customer,
          shippingAddress: attempt.shippingAddress,
          items: attempt.items,
          subtotal: attempt.subtotal,
          discount: attempt.discount,
          total: attempt.total,
          paymentMethod: "WatchPays",
          paymentStatus: "Paid",
          status: "Processing",
          createdAt: now,
          updatedAt: now
        };
        await orders.insertOne(order, { session: mongoSession });
        const updatedAttempt = await paymentAttempts.updateOne(
          { _id: req.params.id, status: "pending" },
          { $set: { status: "manually_verified", linkedOrderId: order._id, updatedAt: now } },
          { session: mongoSession }
        );
        if (!updatedAttempt.modifiedCount) {
          throw Object.assign(new Error("This payment attempt was already reconciled."), { status: 409 });
        }
        confirmedOrder = { id: order._id, total: order.total, status: order.status };
      });
      if (issue) return res.status(issue.status).json({ error: issue.message });
      return res.json(confirmedOrder);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    } finally {
      await mongoSession.endSession();
    }
  });

  app.patch("/api/admin/orders/:id", loginRequired, sameOriginJson, async (req, res, next) => {
    try {
      const status = req.body?.status;
      if (!VALID_STATUSES.has(status)) return res.status(400).json({ error: "Invalid order status." });
      const mongoSession = client.startSession();
      try {
        let updated;
        let issue;
        await mongoSession.withTransaction(async () => {
          const existing = await orders.findOne({ _id: req.params.id }, { session: mongoSession });
          if (!existing) {
            issue = { status: 404, message: "Order not found." };
            return;
          }
          if (existing.status !== status && (existing.status === "Cancelled" || status === "Cancelled")) {
            for (const item of existing.items) {
              const quantity = new Int32(status === "Cancelled" ? item.quantity : -item.quantity);
              const stockUpdate = await products.updateOne(
                { _id: item.productId, ...(status !== "Cancelled" ? { stock: { $gte: item.quantity } } : {}) },
                { $inc: { stock: quantity }, $set: { updatedAt: new Date() } },
                { session: mongoSession }
              );
              if (!stockUpdate.matchedCount && status !== "Cancelled") {
                issue = { status: 409, message: `${item.name} does not have enough stock to reopen this order.` };
                throw Object.assign(new Error(issue.message), { status: issue.status });
              }
            }
          }
          updated = await orders.findOneAndUpdate(
            { _id: req.params.id },
            { $set: { status, updatedAt: new Date() } },
            { returnDocument: "after", session: mongoSession }
          );
        });
        if (issue) return res.status(issue.status).json({ error: issue.message });
        const { _id, ...order } = updated;
        return res.json({ id: String(_id), ...order });
      } finally {
        await mongoSession.endSession();
      }
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      return next(error);
    }
  });

  app.post("/api/admin/products", loginRequired, sameOriginJson, async (req, res, next) => {
    try {
      const homepage = await storeSettings.findOne({ _id: "homepage" });
      const product = parseProduct(req.body, {
        creating: true,
        allowedDepartments: homepage?.headerCategories || DEFAULT_HEADER_CATEGORIES
      });
      if (!product) return res.status(400).json({ error: "Enter a valid product name, department, category, price, discount, stock, and up to four image URLs." });
      const now = new Date();
      const document = { _id: crypto.randomUUID(), ...product, createdAt: now, updatedAt: now };
      await products.insertOne(document);
      return res.status(201).json(asProduct(document));
    } catch (error) {
      return next(error);
    }
  });

  app.put("/api/admin/products/:id", loginRequired, sameOriginJson, async (req, res, next) => {
    try {
      const homepage = await storeSettings.findOne({ _id: "homepage" });
      const product = parseProduct(req.body, {
        allowedDepartments: homepage?.headerCategories || DEFAULT_HEADER_CATEGORIES
      });
      if (!product) return res.status(400).json({ error: "Enter a valid product name, department, category, price, discount, stock, and up to four image URLs." });
      const update = { $set: { ...product, updatedAt: new Date() } };
      if (!product.quickCategory) update.$unset = { quickCategory: "" };
      const updated = await products.findOneAndUpdate(
        { _id: req.params.id },
        update,
        { returnDocument: "after" }
      );
      if (!updated) return res.status(404).json({ error: "Product not found." });
      return res.json(asProduct(updated));
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/admin/products/:id", loginRequired, sameOriginJson, async (req, res, next) => {
    try {
      const result = await products.deleteOne({ _id: req.params.id });
      if (!result.deletedCount) return res.status(404).json({ error: "Product not found." });
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  app.put("/api/admin/storefront", loginRequired, sameOriginJson, async (req, res, next) => {
    try {
      const settings = parseSettings(req.body);
      if (!settings) return res.status(400).json({ error: "All storefront fields must contain valid text." });
      await storeSettings.updateOne(
        { _id: "homepage" },
        { $set: { ...settings, updatedAt: new Date() } },
        { upsert: true }
      );
      return res.json(settings);
    } catch (error) {
      return next(error);
    }
  });

  const publicFiles = new Map([
    ["/", "index.html"],
    ["/index.html", "index.html"],
    ["/admin.html", "admin.html"],
    ["/styles.css", "styles.css"],
    ["/app.js", "app.js"],
    ["/admin.js", "admin.js"],
    ["/store-data.js", "store-data.js"]
  ]);
  app.get([...publicFiles.keys()], (req, res) => {
    res.set("Cache-Control", "no-store");
    res.sendFile(path.join(__dirname, publicFiles.get(req.path)));
  });
  app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "admin.html")));
  app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint not found." }));
  app.use((error, req, res, _next) => {
    console.error("Request failed:", error);
    if (res.headersSent) return;
    if (error.status === 413 && req.path === "/api/admin/product-images") {
      return res.status(413).json({ error: "Product images must be 8 MB or smaller." });
    }
    return res.status(500).json({ error: "The server could not complete the request." });
  });

  const server = app.listen(PORT, () => {
    console.log(`HNM Atelier ready at http://localhost:${PORT}`);
    console.log(`Connected to MongoDB database "${DATABASE_NAME}".`);
  });
  const shutdown = async () => {
    server.close(async () => {
      await client.close();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error("HNM Atelier server failed to start:", error.message);
  process.exitCode = 1;
});
