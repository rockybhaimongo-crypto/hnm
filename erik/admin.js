const { money, escapeHTML } = window.FormeStoreData;
let products = [];
let orders = [];
let paymentAttempts = [];
let ordersPage = 1;
let ordersTotal = 0;
let ordersPages = 0;
let orderSummary = { totalOrders: 0, revenue: 0 };
let settings = {};
let section = "overview";
let editingProductId = null;
let productCollectionFilter = "all";
let toastTimer;

const PRODUCT_COLLECTIONS = [
  ["dresses", "Dresses"],
  ["tops", "Tops"],
  ["baggy-pants", "Baggy pants"],
  ["co-ords", "Co-ords"],
  ["shirts", "Shirts"],
  ["tees", "T-shirts"],
  ["skirts", "Skirts"],
  ["sale", "The offer"]
];
const $ = (selector, root = document) => root.querySelector(selector);
const discountPercentage = (product) => Number.isInteger(product.discountPercentage) ? product.discountPercentage : 20;
const collectionLabel = (quickCategory) => PRODUCT_COLLECTIONS.find(([value]) => value === quickCategory)?.[1] || "";
async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}).`);
  return data;
}
async function uploadAdminImage(file) {
  const response = await fetch("/api/admin/product-images", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": file.type },
    body: file
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || `Image upload failed (${response.status}).`);
  return data;
}
const showToast = (message) => {
  const toast = $("#adminToast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
};
const showLoginError = (message) => {
  $("#adminLoginMessage").textContent = message;
};

async function loadAdminData(page = ordersPage) {
  const [catalog, orderData, summary, paymentData] = await Promise.all([
    apiRequest("/api/storefront"),
    apiRequest(`/api/admin/orders?page=${page}`),
    apiRequest("/api/admin/summary"),
    apiRequest("/api/admin/payment-attempts")
  ]);
  products = catalog.products;
  settings = catalog.settings;
  orders = orderData.orders;
  ordersPage = orderData.page;
  ordersTotal = orderData.total;
  ordersPages = orderData.pages;
  orderSummary = summary;
  paymentAttempts = paymentData.attempts;
}

function render() {
  const nav = [
    ["overview", "▦", "Overview"], ["products", "◇", "Products"], ["orders", "▤", "Orders"], ["storefront", "✳", "Storefront"]
  ];
  $("#adminApp").innerHTML = `
    <header class="admin-topbar">
      <div class="admin-top-left"><a href="index.html" class="wordmark" aria-label="HNM Atelier home"><span class="wordmark-primary">HNM</span><span class="wordmark-name">ATELIER</span></a><span class="admin-top-label">THE STUDIO</span></div>
      <div class="admin-top-actions"><span>Signed in as admin</span><span class="admin-avatar">A</span><button id="adminLogout">Sign out</button><a class="back-to-store" href="index.html">← Back to storefront</a></div>
    </header>
    <div class="admin-layout">
      <aside class="admin-sidebar"><p class="sidebar-caption">THE STUDIO</p>
        ${nav.map(([key, icon, label]) => `<button class="admin-nav-button ${section === key ? "active" : ""}" data-section="${key}"><span>${icon}</span>${label}</button>`).join("")}
        <p class="sidebar-foot">HNM ATELIER<br>Collection management</p>
      </aside>
      <section class="admin-content">${renderSection()}</section>
    </div>`;
  $("#adminLoginScreen").classList.add("hidden");
  $("#adminApp").classList.remove("hidden");
  $("#adminApp").querySelectorAll("[data-section]").forEach((button) => button.addEventListener("click", () => {
    section = button.dataset.section;
    render();
  }));
  $("#adminLogout").addEventListener("click", logout);
  bindActions();
}

function renderSection() {
  if (section === "products") return productsContent();
  if (section === "orders") return ordersContent();
  if (section === "storefront") return storefrontContent();
  const lowStock = products.filter((product) => product.stock < 10).length;
  return `<div class="admin-page-header"><div><span class="eyebrow">THE ATELIER STUDIO</span><h1>Studio overview</h1><p>A clear view of your collection, orders, and inventory.</p></div><button class="admin-primary-button" data-go-section="products">＋ Add a product</button></div>
    <div class="stats-grid">
      <article class="stat-card"><span class="stat-label">Order value</span><strong class="stat-value">${money(orderSummary.revenue)}</strong><span class="stat-foot">Excludes cancelled orders</span></article>
      <article class="stat-card"><span class="stat-label">Orders</span><strong class="stat-value">${orderSummary.totalOrders}</strong><span class="stat-foot">Across all statuses</span></article>
      <article class="stat-card"><span class="stat-label">Active products</span><strong class="stat-value">${products.length}</strong><span class="stat-foot">In your collection</span></article>
      <article class="stat-card"><span class="stat-label">Low stock</span><strong class="stat-value">${lowStock}</strong><span class="stat-foot">Fewer than 10 pieces</span></article>
    </div>
    <div class="admin-panel"><div class="panel-heading"><h2>Recent orders</h2><button data-go-section="orders">View all orders →</button></div>${ordersTable(orders.slice(0, 4), false)}</div>
    <p class="admin-notice">Product, storefront, inventory, and customer orders are managed in MongoDB.</p>`;
}

function productsContent() {
  const visibleProducts = products.filter((product) => {
    if (productCollectionFilter === "all") return true;
    if (productCollectionFilter === "department") return !product.quickCategory;
    if (productCollectionFilter === "sale") return discountPercentage(product) > 0;
    return product.quickCategory === productCollectionFilter;
  });
  return `<div class="admin-page-header"><div><h1>Products</h1><p>Add or edit products in a homepage section. Edit a product to change its name, price, photos, stock, or discount.</p></div><button class="admin-primary-button" id="addProductButton">＋ Add product</button></div>
    <div class="admin-panel"><div class="panel-heading"><h2>Your collection · ${visibleProducts.length} items</h2><label class="product-collection-filter-label">Show <select class="product-collection-filter" id="productCollectionFilter"><option value="all" ${productCollectionFilter === "all" ? "selected" : ""}>All collections</option><option value="department" ${productCollectionFilter === "department" ? "selected" : ""}>Department products</option>${PRODUCT_COLLECTIONS.map(([value, label]) => `<option value="${value}" ${productCollectionFilter === value ? "selected" : ""}>${escapeHTML(label)}</option>`).join("")}</select></label></div>${productsTable(visibleProducts)}</div>
    <div class="admin-panel hidden" id="productFormPanel"></div>`;
}

function productsTable(items) {
  if (!items.length) return `<div class="admin-empty">No products in this section yet. Use “Add product” and choose the matching homepage section.</div>`;
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>PRODUCT</th><th>PRICE</th><th>INVENTORY</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>${items.map((product) => `
    <tr><td><div class="table-product"><img src="${escapeHTML(product.image)}" alt=""><span><strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(product.department || "Unassigned")} · ${escapeHTML(product.category)}${product.quickCategory ? ` · ${escapeHTML(collectionLabel(product.quickCategory))} section` : ""}</small></span></div></td>
    <td>${discountPercentage(product) > 0 ? `<del>${money(product.price)}</del><strong class="admin-sale-price">${money(product.price * (1 - discountPercentage(product) / 100))}</strong><small class="admin-discount-label">${discountPercentage(product)}% off</small>` : `${money(product.price)}<small class="admin-discount-label">No discount</small>`}</td><td>${product.stock} units</td><td><span class="status-pill ${product.stock < 1 ? "cancelled" : product.stock < 10 ? "pending" : ""}">${product.stock < 1 ? "Out of stock" : product.stock < 10 ? "Low stock" : "Active"}</span></td>
    <td class="table-actions"><button data-edit-product="${escapeHTML(product.id)}">Edit</button><button class="delete-action" data-delete-product="${escapeHTML(product.id)}">Delete</button></td></tr>`).join("")}</tbody></table></div>`;
}

function ordersContent() {
  return `<div class="admin-page-header"><div><h1>Orders</h1><p>Review orders and update their fulfilment status.</p></div></div>
    <div class="admin-panel"><div class="panel-heading"><h2>All orders · ${ordersTotal}</h2></div>${ordersTable(orders, true)}
    ${ordersPages > 1 ? `<div class="orders-pagination"><button data-order-page="${ordersPage - 1}" ${ordersPage <= 1 ? "disabled" : ""}>← Previous</button><span>Page ${ordersPage} of ${ordersPages}</span><button data-order-page="${ordersPage + 1}" ${ordersPage >= ordersPages ? "disabled" : ""}>Next →</button></div>` : ""}</div>
    <div class="admin-panel"><div class="panel-heading"><h2>WatchPays payments · latest ${paymentAttempts.length}</h2></div>${paymentAttemptsTable()}</div>
    <p class="admin-notice">Payment callbacks from WatchPays are unsigned and are never trusted as proof of payment. Check each payment in your WatchPays merchant dashboard before manually confirming it here. Customer contact and delivery details are visible only in this protected admin panel.</p>`;
}

function paymentAttemptsTable() {
  if (!paymentAttempts.length) return `<div class="admin-empty">No online payment attempts yet.</div>`;
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>MERCHANT ORDER</th><th>CUSTOMER</th><th>AMOUNT</th><th>GATEWAY NOTICE</th><th>STATUS</th></tr></thead><tbody>${paymentAttempts.map((attempt) => `
    <tr><td><strong>${escapeHTML(attempt.merchantOrderNo)}</strong><small>Gateway: ${escapeHTML(attempt.gatewayOrderNo)}</small></td>
      <td>${escapeHTML(attempt.customer?.name || "Customer")}<small>${escapeHTML(attempt.customer?.email || "")}</small></td>
      <td>${money(attempt.total)}</td>
      <td>${attempt.unverifiedCallback
        ? `Unverified: ${escapeHTML(attempt.unverifiedCallback.status)} · ${new Date(attempt.unverifiedCallback.receivedAt).toLocaleString()}`
        : "No callback received"}</td>
      <td>${attempt.status === "manually_verified"
        ? `<span class="status-pill">Confirmed · ${escapeHTML(attempt.linkedOrderId || "")}</span>`
        : `<button class="admin-primary-button" data-confirm-payment="${escapeHTML(attempt.merchantOrderNo)}">Verify in WatchPays & confirm</button>`}</td></tr>`).join("")}</tbody></table></div>`;
}

function ordersTable(items, allowStatusEdit) {
  if (!items.length) return `<div class="admin-empty">No confirmed customer orders yet.</div>`;
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>ORDER</th><th>CUSTOMER</th><th>DATE</th><th>TOTAL</th><th>STATUS</th></tr></thead><tbody>${items.map((order) => `
    <tr><td><strong>${escapeHTML(order.id)}</strong><details class="order-detail"><summary>Order details</summary>
      <div><strong>Contact</strong><span>${escapeHTML(order.customer?.email || "")}</span><span>${escapeHTML(order.customer?.phone || "")}</span></div>
      <div><strong>Delivery address</strong><span>${escapeHTML([order.shippingAddress?.line1, order.shippingAddress?.line2, order.shippingAddress?.city, order.shippingAddress?.region, order.shippingAddress?.postalCode, order.shippingAddress?.country].filter(Boolean).join(", "))}</span></div>
      <div><strong>Items</strong>${(order.items || []).map((item) => `<span>${escapeHTML(item.name)}${item.size ? ` · Size ${escapeHTML(item.size)}` : ""} · ${item.quantity} × ${money(item.unitPrice)} (${Number.isInteger(item.discountPercentage) ? item.discountPercentage : 20}% off)</span>`).join("")}</div>
      <div><strong>Payment</strong><span>${escapeHTML(order.paymentMethod || "Online payment")} · ${escapeHTML(order.paymentStatus || "Pending")}</span></div>
      <div><strong>Subtotal / offer</strong><span>${money(order.subtotal)} / −${money(order.discount)}</span></div>
    </details></td><td>${escapeHTML(order.customer?.name || "Customer")}</td><td>${new Date(order.createdAt).toLocaleDateString()}</td><td>${money(order.total)}</td><td>${allowStatusEdit
      ? `<select class="order-select" data-order-status="${escapeHTML(order.id)}">${["Processing", "Shipped", "Delivered", "Cancelled"].map((status) => `<option ${order.status === status ? "selected" : ""}>${status}</option>`).join("")}</select>`
      : `<span class="status-pill ${order.status === "Processing" ? "pending" : order.status === "Cancelled" ? "cancelled" : ""}">${escapeHTML(order.status)}</span>`}</td></tr>`).join("")}</tbody></table></div>`;
}

function storefrontContent() {
  const headerCategories = Array.isArray(settings.headerCategories) ? settings.headerCategories : ["Ladies", "Home", "Beauty"];
  const categoryImages = Array.isArray(settings.categoryImages) ? settings.categoryImages : [];
  return `<div class="admin-page-header"><div><h1>Storefront</h1><p>Change the homepage category labels, headline, and hero banner images.</p></div></div>
    <div class="admin-panel store-settings-form"><div class="panel-heading"><h2>Homepage content</h2></div>
      <form class="admin-form" id="storeSettingsForm">
        <label class="full-width">Announcement bar<input name="announcement" maxlength="110" value="${escapeHTML(settings.announcement)}"></label>
        <div class="full-width"><strong>Header category labels</strong><p class="settings-preview">These three labels appear in the black menu below the main navigation.</p></div>
        ${headerCategories.map((category, index) => `<label>Category ${index + 1} label<input name="headerCategory${index + 1}" maxlength="24" required value="${escapeHTML(category)}"></label><label>Category ${index + 1} image URL<input name="categoryImage${index + 1}" type="url" maxlength="2048" required value="${escapeHTML(categoryImages[index] || "")}" placeholder="https://…"></label>`).join("")}
        <label>Hero headline<input name="heroTitle" maxlength="50" value="${escapeHTML(settings.heroTitle.replace("\n", " "))}"></label>
        <label>Hero supporting text<input name="heroSubtitle" maxlength="120" value="${escapeHTML(settings.heroSubtitle)}"></label>
        ${[["heroImage", "Hero slide 1"], ["heroImage2", "Hero slide 2"], ["heroImage3", "Hero slide 3"]].map(([key, label]) => `<div class="full-width hero-image-setting"><label>${label} image URL<input name="${key}" data-hero-image-url="${key}" type="text" maxlength="2048" value="${escapeHTML(settings[key] || "")}" placeholder="https://… or upload below"></label><label>Upload ${label.toLowerCase()} image<input data-hero-image-upload="${key}" type="file" accept="image/jpeg,image/png,image/webp"><img class="hero-image-preview" data-hero-image-preview="${key}" src="${escapeHTML(settings[key] || "")}" alt="${label} preview" ${settings[key] ? "" : "hidden"}><small>JPEG, PNG, or WebP; up to 8 MB.</small></label></div>`).join("")}
        <div class="full-width settings-preview">Upload a banner image here or paste an image URL, then save the storefront. The three hero images slide automatically from right to left. Leave a slide blank to remove its image; leave all three blank to remove hero photos.</div>
        <div class="full-width admin-form-actions"><button type="submit" class="admin-primary-button">Save storefront</button></div>
      </form>
    </div>`;
}

function showProductForm(product = null, defaultQuickCategory = "") {
  editingProductId = product ? product.id : null;
  const panel = $("#productFormPanel");
  const images = (product?.images?.length ? product.images : product ? [product.image] : []).slice(0, 4);
  const departments = Array.isArray(settings.headerCategories) ? settings.headerCategories : ["Ladies", "Home", "Beauty"];
  panel.classList.remove("hidden");
  panel.innerHTML = `<div class="panel-heading"><h2>${product ? "Edit product" : "Add a product"}</h2><button type="button" id="closeProductForm">Close ×</button></div>
    <form class="admin-form" id="productForm">
      <label>Product name<input name="name" required maxlength="70" value="${escapeHTML(product?.name || "")}" placeholder="e.g. The Everyday Shirt"></label>
      <label>Department<select name="department" required>${departments.map((department) => `<option ${product?.department === department || (!product && department === departments[0]) ? "selected" : ""}>${escapeHTML(department)}</option>`).join("")}</select></label>
      <label>Product type<select name="category" required>${["Clothing", "Accessories", "Home", "Beauty"].map((category) => `<option ${product?.category === category || (!product && category === "Clothing") ? "selected" : ""}>${category}</option>`).join("")}</select></label>
      <label>Homepage section<select name="quickCategory"><option value="" ${!product?.quickCategory && !defaultQuickCategory ? "selected" : ""}>Department collection</option>${PRODUCT_COLLECTIONS.map(([value, label]) => `<option value="${value}" ${product?.quickCategory === value || (!product && defaultQuickCategory === value) ? "selected" : ""}>${escapeHTML(label)}${value === "sale" ? " (discounted products)" : ""}</option>`).join("")}</select><small>Choose the homepage edit circle where this product should appear. Discounted products appear in The offer automatically.</small></label>
      <label>Price (INR)<input name="price" type="number" min="0.01" step="0.01" required value="${product ? Number(product.price) : ""}" placeholder="2799"></label>
      <label>Product discount (%)<input name="discountPercentage" type="number" min="0" max="100" step="1" required value="${Number.isInteger(product?.discountPercentage) ? product.discountPercentage : 20}"><small>Set 0 for no discount. The selling price updates automatically.</small></label>
      <label>Inventory quantity<input name="stock" type="number" min="0" step="1" required value="${product ? Number(product.stock) : ""}" placeholder="24"></label>
      <label class="full-width product-image-upload">Upload product photos<input id="productImageUpload" type="file" accept="image/jpeg,image/png,image/webp" multiple><small>Choose up to 4 JPEG, PNG, or WebP images (8 MB each). Uploading replaces the current image set.</small></label>
      <div class="full-width product-image-fields">${[0, 1, 2, 3].map((index) => `<label>Image ${index + 1}<img class="product-image-preview" data-image-preview="${index}" ${images[index] ? `src="${escapeHTML(images[index])}"` : ""} alt="Product image ${index + 1} preview" ${images[index] ? "" : "hidden"}><input name="image${index + 1}" data-product-image-url="${index}" type="text" ${index === 0 ? "required" : ""} value="${escapeHTML(images[index] || "")}" placeholder="Upload or paste an image URL"></label>`).join("")}</div>
      <label class="full-width">Badge (optional)<input name="badge" maxlength="18" value="${escapeHTML(product?.badge || "")}" placeholder="BESTSELLER"></label>
      <div class="full-width admin-form-actions"><button type="button" class="admin-secondary-button" id="cancelProductForm">Cancel</button><button type="submit" class="admin-primary-button">${product ? "Save changes" : "Create product"}</button></div>
    </form>`;
  $("#closeProductForm").addEventListener("click", () => panel.classList.add("hidden"));
  $("#cancelProductForm").addEventListener("click", () => panel.classList.add("hidden"));
  $("#productForm").querySelectorAll("[data-product-image-url]").forEach((input) => input.addEventListener("input", () => {
    const preview = $(`[data-image-preview="${input.dataset.productImageUrl}"]`, $("#productForm"));
    const url = input.value.trim();
    if (url) preview.src = url;
    else preview.removeAttribute("src");
    preview.hidden = !url;
  }));
  let uploadingImages = false;
  $("#productImageUpload").addEventListener("change", async (event) => {
    const files = [...event.currentTarget.files];
    if (!files.length) return;
    if (files.length > 4) {
      event.currentTarget.value = "";
      showToast("Choose up to 4 images for one product.");
      return;
    }
    if (files.some((file) => file.size > 8 * 1024 * 1024)) {
      event.currentTarget.value = "";
      showToast("Each product image must be 8 MB or smaller.");
      return;
    }
    const inputs = [...$("#productForm").querySelectorAll("[data-product-image-url]")];
    inputs.forEach((input) => {
      input.value = "";
      input.dispatchEvent(new Event("input"));
    });
    const uploadInput = event.currentTarget;
    const submitButton = $("#productForm button[type='submit']");
    uploadingImages = true;
    uploadInput.disabled = true;
    submitButton.disabled = true;
    try {
      for (const [index, file] of files.entries()) {
        const data = await uploadAdminImage(file);
        inputs[index].value = data.url;
        inputs[index].dispatchEvent(new Event("input"));
      }
      showToast(`${files.length} product ${files.length === 1 ? "image" : "images"} uploaded.`);
    } catch (error) {
      showToast(error.message);
    } finally {
      uploadingImages = false;
      submitButton.disabled = false;
      uploadInput.disabled = false;
      uploadInput.value = "";
    }
  });
  $("#productForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (uploadingImages) {
      showToast("Wait for product images to finish uploading.");
      return;
    }
    const formData = new FormData(event.currentTarget);
    const productData = {
      name: formData.get("name").trim(),
      department: formData.get("department"),
      category: formData.get("category"),
      quickCategory: formData.get("quickCategory"),
      price: Number(formData.get("price")),
      discountPercentage: Number(formData.get("discountPercentage")),
      stock: Number(formData.get("stock")),
      image: formData.get("image1").trim(),
      images: [1, 2, 3, 4].map((index) => formData.get(`image${index}`))
        .map((image) => image.trim())
        .filter(Boolean),
      badge: formData.get("badge").trim()
    };
    if (!productData.name || !Number.isFinite(productData.price) || productData.price <= 0 ||
        !Number.isInteger(productData.discountPercentage) || productData.discountPercentage < 0 || productData.discountPercentage > 100 ||
        !Number.isInteger(productData.stock) || productData.stock < 0) {
      showToast("Enter a product name, valid price, discount from 0 to 100, and whole inventory quantity.");
      return;
    }
    const wasEditing = Boolean(editingProductId);
    const url = wasEditing ? `/api/admin/products/${encodeURIComponent(editingProductId)}` : "/api/admin/products";
    try {
      await apiRequest(url, {
        method: wasEditing ? "PUT" : "POST",
        body: JSON.stringify(productData)
      });
      await loadAdminData();
      render();
      showToast(wasEditing ? "Product updated in MongoDB." : "Product added to MongoDB.");
    } catch (error) {
      showToast(error.message);
    }
  });
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function bindActions() {
  $("#adminApp").querySelectorAll("[data-go-section]").forEach((button) => button.addEventListener("click", () => {
    section = button.dataset.goSection;
    render();
  }));
  $("#adminApp").querySelectorAll("[data-order-page]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await loadAdminData(Number(button.dataset.orderPage));
      render();
    } catch (error) {
      showToast(error.message);
    }
  }));
  const addButton = $("#addProductButton");
  if (addButton) addButton.addEventListener("click", () => showProductForm(
    null,
    PRODUCT_COLLECTIONS.some(([value]) => value === productCollectionFilter) ? productCollectionFilter : ""
  ));
  const collectionFilter = $("#productCollectionFilter");
  if (collectionFilter) collectionFilter.addEventListener("change", () => {
    productCollectionFilter = collectionFilter.value;
    render();
  });
  $("#adminApp").querySelectorAll("[data-edit-product]").forEach((button) => button.addEventListener("click", () => {
    showProductForm(products.find((item) => item.id === button.dataset.editProduct));
  }));
  $("#adminApp").querySelectorAll("[data-delete-product]").forEach((button) => button.addEventListener("click", async () => {
    const product = products.find((item) => item.id === button.dataset.deleteProduct);
    if (!product || !window.confirm(`Delete "${product.name}" from the storefront?`)) return;
    try {
      await apiRequest(`/api/admin/products/${encodeURIComponent(product.id)}`, { method: "DELETE", body: "{}" });
      products = products.filter((item) => item.id !== product.id);
      render();
      showToast("Product deleted from MongoDB.");
    } catch (error) {
      showToast(error.message);
    }
  }));
  $("#adminApp").querySelectorAll("[data-order-status]").forEach((select) => select.addEventListener("change", async () => {
    try {
      await apiRequest(`/api/admin/orders/${encodeURIComponent(select.dataset.orderStatus)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: select.value })
      });
      await loadAdminData(ordersPage);
      render();
      showToast("Order status saved in MongoDB.");
    } catch (error) {
      showToast(error.message);
    }
  }));
  $("#adminApp").querySelectorAll("[data-confirm-payment]").forEach((button) => button.addEventListener("click", async () => {
    const merchantOrderNo = button.dataset.confirmPayment;
    if (!window.confirm(`First confirm in the WatchPays dashboard that ${merchantOrderNo} was successfully paid for the exact amount shown. The callback alone is not proof. Continue?`)) return;
    button.disabled = true;
    try {
      const order = await apiRequest(`/api/admin/payment-attempts/${encodeURIComponent(merchantOrderNo)}/confirm`, {
        method: "POST",
        body: "{}"
      });
      await loadAdminData(ordersPage);
      render();
      showToast(`Payment manually verified. Order ${order.id} created.`);
    } catch (error) {
      button.disabled = false;
      showToast(error.message);
    }
  }));
  const settingsForm = $("#storeSettingsForm");
  if (settingsForm) {
    settingsForm.querySelectorAll("[data-hero-image-url]").forEach((input) => input.addEventListener("input", () => {
      const preview = $(`[data-hero-image-preview="${input.dataset.heroImageUrl}"]`, settingsForm);
      if (input.value.trim()) preview.src = input.value.trim();
      else preview.removeAttribute("src");
      preview.hidden = !input.value.trim();
    }));
    settingsForm.querySelectorAll("[data-hero-image-upload]").forEach((input) => input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        input.value = "";
        showToast("Banner images must be 8 MB or smaller.");
        return;
      }
      input.disabled = true;
      const formSubmit = settingsForm.querySelector("button[type='submit']");
      formSubmit.disabled = true;
      try {
        const uploaded = await uploadAdminImage(file);
        const urlInput = settingsForm.querySelector(`[data-hero-image-url="${input.dataset.heroImageUpload}"]`);
        urlInput.value = uploaded.url;
        urlInput.dispatchEvent(new Event("input"));
        showToast("Banner uploaded. Save storefront to publish it.");
      } catch (error) {
        showToast(error.message);
      } finally {
        input.disabled = false;
        input.value = "";
        formSubmit.disabled = false;
      }
    }));
    settingsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(settingsForm);
      const updatedSettings = {
        announcement: data.get("announcement").trim(),
        heroTitle: data.get("heroTitle").trim(),
        heroSubtitle: data.get("heroSubtitle").trim(),
        heroImage: data.get("heroImage").trim(),
        heroImage2: data.get("heroImage2").trim(),
        heroImage3: data.get("heroImage3").trim(),
        campaignBannerImage: settings.campaignBannerImage,
        headerCategories: settings.headerCategories.map((_, index) => data.get(`headerCategory${index + 1}`).trim()),
        categoryImages: settings.categoryImages.map((_, index) => data.get(`categoryImage${index + 1}`).trim())
      };
      try {
        settings = await apiRequest("/api/admin/storefront", {
          method: "PUT",
          body: JSON.stringify(updatedSettings)
        });
        showToast("Storefront content saved in MongoDB.");
      } catch (error) {
        showToast(error.message);
      }
    });
  }
}

function showLogin() {
  $("#adminApp").classList.add("hidden");
  $("#adminLoginScreen").classList.remove("hidden");
}

async function logout() {
  try {
    await apiRequest("/api/admin/logout", { method: "POST", body: "{}" });
    showLogin();
    $("#adminLoginForm").reset();
    showLoginError("");
    $("#adminPassword").focus();
  } catch (error) {
    showToast(error.message);
  }
}

$("#adminLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("#adminEmail").value.trim().toLowerCase();
  const password = $("#adminPassword").value;
  showLoginError("");
  try {
    await apiRequest("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    await loadAdminData();
    section = "overview";
    render();
  } catch (error) {
    showLoginError(error.message === "Email or password is incorrect."
      ? error.message
      : `Unable to sign in: ${error.message}`);
  }
});

async function initializeAdmin() {
  try {
    const sessionState = await apiRequest("/api/admin/session");
    if (!sessionState.authenticated) return;
    await loadAdminData();
    render();
  } catch (error) {
    showLoginError(`MongoDB server unavailable: ${error.message}`);
  }
}
initializeAdmin();
