const { read, save, money, escapeHTML } = window.FormeStoreData;
let products = [];
let cart = read("forme-cart", {});
let settings = {
  announcement: "FLAT 55% OFF YOUR FAVOURITES | MEMBER EXCLUSIVE",
  heroTitle: "Style, considered.",
  heroSubtitle: "A thoughtfully curated edit for feeling like your most effortless self.",
  heroImage: "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=2200&q=88",
  heroImage2: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=2200&q=88",
  heroImage3: "https://images.unsplash.com/photo-1487222477894-8943e31ef7b2?auto=format&fit=crop&w=2200&q=88",
  campaignBannerImage: "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=1800&q=88",
  headerCategories: ["Ladies", "Home", "Beauty"],
  categoryImages: [
    "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=800&q=85",
    "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=800&q=85",
    "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=800&q=85"
  ]
};
let favorites = new Set(read("forme-favorites", []));
let guestFavorites = new Set(favorites);
let activeDepartment = "Ladies";
let activeQuickCategory = "";
let quickCategoryReturnDepartment = "Ladies";
let toastTimer;
let storeLoadError = "";
let heroSlideIndex = 0;
let heroSlideTimer;
let heroTransitionTimer;
let account = null;
let accountMode = "signin";
let accountSessionError = "";
let accountSessionLoaded = false;
let accountWishlistLoaded = false;
let pendingWishlistOpen = false;
let pendingWishlistProductId = "";
const DEFAULT_DISCOUNT_PERCENTAGE = 20;
const heroSlideInterval = 5600;
const reducedMotionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");

const $ = (selector, root = document) => root.querySelector(selector);
const productDiscountPercentage = (product) => Number.isInteger(product.discountPercentage)
  ? product.discountPercentage
  : DEFAULT_DISCOUNT_PERCENTAGE;
const salePrice = (product) => Math.round(product.price * (1 - productDiscountPercentage(product) / 100) * 100) / 100;
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
function heroSlides() {
  return [...document.querySelectorAll(".hero-image:not([hidden])")];
}
function showHeroSlide(index) {
  const slides = heroSlides();
  if (slides.length < 2) return;
  const nextIndex = (index + slides.length) % slides.length;
  if (nextIndex === heroSlideIndex && slides[nextIndex].classList.contains("is-active")) return;

  clearTimeout(heroTransitionTimer);
  const currentSlide = slides[heroSlideIndex];
  const nextSlide = slides[nextIndex];
  slides.forEach((slide) => slide.classList.remove("is-leaving"));
  heroSlideIndex = nextIndex;
  requestAnimationFrame(() => {
    if (currentSlide) {
      currentSlide.classList.remove("is-active");
      currentSlide.classList.add("is-leaving");
    }
    nextSlide.classList.add("is-active");
  });
  heroTransitionTimer = setTimeout(() => {
    slides.forEach((slide) => slide.classList.remove("is-leaving"));
  }, 1500);
}
function stopHeroSlideTimer() {
  clearInterval(heroSlideTimer);
  heroSlideTimer = undefined;
}
function startHeroSlideTimer() {
  stopHeroSlideTimer();
  if (document.hidden || reducedMotionPreference.matches || heroSlides().length < 2) return;
  heroSlideTimer = setInterval(() => showHeroSlide(heroSlideIndex + 1), heroSlideInterval);
}
const showToast = (message) => {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
};
const saveStore = (key, value) => {
  if (!save(key, value)) showToast("Changes could not be saved in this browser.");
};

function renderProductCard(product) {
  const discountPercentage = productDiscountPercentage(product);
  return `
    <article class="product-card">
      <div class="product-image-wrap">
        <img class="product-image" data-product-open="${escapeHTML(product.id)}" data-product-main-image="${escapeHTML(product.id)}" src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy" tabindex="0" role="button" aria-label="View ${escapeHTML(product.name)} details">
        ${discountPercentage > 0 ? `<span class="product-badge atelier-product-badge">ATELIER · ${discountPercentage}% OFF</span>` : ""}
        ${product.badge ? `<span class="product-badge product-detail-badge">${escapeHTML(product.badge)}</span>` : ""}
        <button class="wishlist-button ${favorites.has(product.id) ? "is-favourite" : ""}" data-favorite="${escapeHTML(product.id)}" aria-label="${favorites.has(product.id) ? "Remove from" : "Add to"} favourites">${favorites.has(product.id) ? "♥" : "♡"}</button>
        <button class="quick-add" data-add-cart="${escapeHTML(product.id)}" ${product.stock < 1 ? "disabled" : ""}>${product.stock < 1 ? "SOLD OUT" : product.category === "Clothing" ? "CHOOSE SIZE" : `ADD TO BAG — ${money(salePrice(product))}`}</button>
      </div>
      ${(product.images || [product.image]).length > 1 ? `<div class="product-image-gallery" aria-label="${escapeHTML(product.name)} photos">${(product.images || [product.image]).map((image, index) => `<button class="product-image-thumb ${index === 0 ? "active" : ""}" data-product-image="${escapeHTML(product.id)}" data-product-image-index="${index}" aria-label="View product photo ${index + 1}"><img src="${escapeHTML(image)}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}
      <div class="product-details"><button class="product-name" data-product-open="${escapeHTML(product.id)}">${escapeHTML(product.name)}</button><span class="product-price">${discountPercentage > 0 ? `<del>${money(product.price)}</del>` : ""}<strong>${money(salePrice(product))}</strong></span></div>
      <div class="product-category">${escapeHTML(product.department || product.category)} · ${product.stock} in stock</div>
    </article>`;
}

function renderProducts() {
  const query = $("#productSearch").value.trim().toLowerCase();
  const visible = products.filter((product) =>
    (activeQuickCategory
      ? activeQuickCategory === "sale" ? productDiscountPercentage(product) > 0 : product.quickCategory === activeQuickCategory
      : !product.quickCategory && (activeDepartment === "All" || product.department === activeDepartment)) &&
    `${product.name} ${product.category} ${product.department || ""}`.toLowerCase().includes(query)
  );
  $("#shopTitle").textContent = activeQuickCategory
    ? activeQuickCategory === "sale"
      ? "The Atelier offer"
      : activeQuickCategory === "baggy-pants"
        ? "Baggy pants edit"
      : `${activeQuickCategory[0].toUpperCase()}${activeQuickCategory.slice(1)} edit`
    : activeDepartment === "All" ? "The complete edit" : activeDepartment === "Ladies" ? "Buy Women's Collection Online" : `${activeDepartment} collection`;
  $("#backToCollection").hidden = !activeQuickCategory;
  $("#viewAllLink").hidden = Boolean(activeQuickCategory);
  $("#storeStatus").hidden = !storeLoadError;
  $("#storeStatus").textContent = storeLoadError;
  $("#ladiesFeature").hidden = activeQuickCategory || activeDepartment !== "Ladies";
  $("#beautyFeature").hidden = activeQuickCategory || activeDepartment !== "Beauty";
  $("#winterCollection").hidden = Boolean(activeQuickCategory) || (activeDepartment !== "Ladies" && activeDepartment !== "All");
  $("#productGrid").innerHTML = activeQuickCategory
    ? storeLoadError ? "" : visible.length
      ? visible.map(renderProductCard).join("")
      : activeQuickCategory === "baggy-pants"
        ? `<div class="empty-category"><span class="eyebrow">THE ATELIER EDIT</span><h3>More baggy pants are on the way.</h3><p>Explore the latest piece in this edit.</p></div>`
        : `<p class="empty-results">Nothing here just yet. Check back soon or explore another edit.</p>`
    : storeLoadError ? "" : visible.length ? visible.map(renderProductCard).join("") : `<p class="empty-results">Nothing here just yet. Try another search or browse all pieces.</p>`;
  const winterProducts = products.filter((product) => !product.quickCategory && product.department === "Ladies" && product.category === "Clothing").slice(0, 4);
  $("#winterProductGrid").innerHTML = storeLoadError ? "" : winterProducts.map(renderProductCard).join("");
  renderWishlist();
  observeReveal($("#productGrid").querySelectorAll(".product-card"));
  observeReveal($("#winterProductGrid").querySelectorAll(".product-card"));
}

const clothingSizes = ["XS", "S", "M", "L", "XL", "XXL"];
const waistSizes = ["24", "26", "28", "30", "32", "34", "36", "38"];
const unavailableWaistSizes = new Set(["36", "38"]);
let selectedProductId = "";
let selectedProductSize = "";

function productSizes(product) {
  return product.quickCategory === "baggy-pants" ? waistSizes : clothingSizes;
}

function isProductSizeAvailable(product, size) {
  return productSizes(product).includes(size) &&
    !(product.quickCategory === "baggy-pants" && unavailableWaistSizes.has(size));
}

function openProductDetails(id) {
  const product = products.find((item) => item.id === id);
  if (!product) return;
  selectedProductId = id;
  selectedProductSize = "";
  const images = product.images?.length ? product.images : [product.image];
  const isWaistSized = product.quickCategory === "baggy-pants";
  $("#productDetailsContent").innerHTML = `
    <button class="modal-close product-detail-close" data-close-product aria-label="Close product details">×</button>
    <div class="product-detail-image-wrap">
      <img class="product-detail-image" src="${escapeHTML(images[0])}" alt="${escapeHTML(product.name)}">
      ${images.length > 1 ? `<div class="product-detail-gallery">${images.map((image, index) => `<button type="button" class="product-image-thumb ${index === 0 ? "active" : ""}" data-detail-image="${index}" aria-label="View product photo ${index + 1}"><img src="${escapeHTML(image)}" alt=""></button>`).join("")}</div>` : ""}
    </div>
    <div class="product-detail-info ${isWaistSized ? "has-waist-sizes" : ""}">
      <span class="eyebrow">${escapeHTML(product.department || product.category)}</span>
      <h2 id="productDetailTitle">${escapeHTML(product.name)}</h2>
      <p class="product-detail-price">${money(salePrice(product))}${productDiscountPercentage(product) > 0 ? ` <del>${money(product.price)}</del>` : ""}</p>
      ${productDiscountPercentage(product) > 0 ? `<span class="product-detail-stock-badge">${productDiscountPercentage(product)}% off</span>` : ""}
      ${product.badge ? `<span class="product-detail-stock-badge">${escapeHTML(product.badge)}</span>` : ""}
      ${product.category === "Clothing" ? `<fieldset class="size-picker"><legend class="size-picker-heading">Size${isWaistSized ? `<button type="button" class="size-guide-toggle" data-size-guide aria-expanded="false">Size Guide</button>` : ""}</legend>${isWaistSized ? `<p class="size-guide-note" hidden>Waist sizes are shown in inches. Sizes 36 and 38 are currently unavailable.</p>` : ""}<div class="size-options ${isWaistSized ? "waist-size-options" : ""}">${productSizes(product).map((size) => {
        const available = isProductSizeAvailable(product, size);
        return `<button type="button" class="size-option ${available ? "" : "unavailable"}" data-product-size="${size}" aria-label="${isWaistSized ? `Waist ${size}` : `Size ${size}`}${available ? "" : " — sold out"}" aria-pressed="false" ${available ? "" : "disabled"}>${size}</button>`;
      }).join("")}</div></fieldset>` : ""}
      <p class="product-detail-availability">${product.stock > 0 ? `${product.stock} in stock` : "Sold out"}</p>
      <p class="product-size-message" id="productSizeMessage" role="status"></p>
      <button type="button" class="button button-dark product-detail-add" id="productDetailAdd" ${product.stock < 1 ? "disabled" : ""}>${product.stock < 1 ? "SOLD OUT" : "ADD TO BAG"}</button>
    </div>`;
  $("#productDetailsModal").classList.remove("hidden");
  $("#productDetailAdd").focus();
}

function closeProductDetails() {
  $("#productDetailsModal").classList.add("hidden");
  selectedProductId = "";
  selectedProductSize = "";
}

function observeReveal(elements = document.querySelectorAll("[data-reveal]")) {
  elements.forEach((element, index) => {
    element.dataset.reveal = "";
    if (element.classList.contains("product-card")) element.style.setProperty("--reveal-delay", `${(index % 4) * 65}ms`);
    if (!revealObserver) {
      element.classList.add("is-visible");
      return;
    }
    revealObserver.observe(element);
  });
}

function setDepartment(department) {
  activeQuickCategory = "";
  activeDepartment = department;
  $("#categoryNav").querySelectorAll("a").forEach((item) => item.classList.toggle("active", item.textContent.trim() === department));
  renderProducts();
}

function scrollToSection(section) {
  section.scrollIntoView({ behavior: reducedMotionPreference.matches ? "auto" : "smooth", block: "start" });
}

function cartKey(id, size = "") {
  return size ? `${id}::${size}` : id;
}

function cartEntry(key, quantity) {
  const separator = key.lastIndexOf("::");
  return separator < 0
    ? { key, id: key, size: "", quantity }
    : { key, id: key.slice(0, separator), size: key.slice(separator + 2), quantity };
}

function currentCartEntries() {
  return Object.entries(cart)
    .map(([key, quantity]) => cartEntry(key, quantity))
    .filter((entry) => entry.quantity > 0 && products.some((product) => product.id === entry.id));
}

function productCartQuantity(id) {
  return currentCartEntries()
    .filter((entry) => entry.id === id)
    .reduce((sum, entry) => sum + entry.quantity, 0);
}

function addToCart(id, size = "") {
  const product = products.find((item) => item.id === id);
  if (!product) return;
  if (product.category === "Clothing" && !isProductSizeAvailable(product, size)) {
    openProductDetails(id);
    $("#productSizeMessage").textContent = "Please select a size before adding this item to your bag.";
    return;
  }
  if (product.stock < 1) {
    showToast("This piece is currently out of stock.");
    return;
  }
  if (productCartQuantity(id) >= product.stock) {
    showToast("You have reached the available stock for this piece.");
    return;
  }
  const key = cartKey(id, size);
  cart[key] = (cart[key] || 0) + 1;
  saveStore("forme-cart", cart);
  renderCart();
  showToast(`${product.name} added to your bag.`);
  closeProductDetails();
  openCart();
}

function updateCartQuantity(key, amount) {
  const { id } = cartEntry(key, 0);
  const product = products.find((item) => item.id === id);
  const next = (cart[key] || 0) + amount;
  if (next <= 0) delete cart[key];
  else if (product && productCartQuantity(id) + amount <= product.stock) cart[key] = next;
  else if (product) showToast("You have reached the available stock for this piece.");
  saveStore("forme-cart", cart);
  renderCart();
}

function renderCart() {
  const entries = currentCartEntries();
  const count = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const originalSubtotal = entries.reduce((sum, entry) => sum + products.find((product) => product.id === entry.id).price * entry.quantity, 0);
  const subtotal = entries.reduce((sum, entry) => sum + salePrice(products.find((product) => product.id === entry.id)) * entry.quantity, 0);
  $("#cartCount").textContent = count;
  $("#drawerItemCount").textContent = `(${count})`;
  $("#cartItems").innerHTML = entries.map(({ key, id, size, quantity }) => {
    const product = products.find((item) => item.id === id);
    return `<article class="cart-line">
      <img src="${escapeHTML(product.image)}" alt="">
      <div class="cart-line-info"><div class="cart-line-name">${escapeHTML(product.name)}</div><div class="cart-line-category">${escapeHTML(product.category)}${size ? ` · Size ${escapeHTML(size)}` : ""}</div>
        <div class="quantity-control"><button data-quantity="${escapeHTML(key)}" data-change="-1" aria-label="Decrease quantity">−</button><span>${quantity}</span><button data-quantity="${escapeHTML(key)}" data-change="1" aria-label="Increase quantity">+</button></div>
      </div><div class="cart-line-price"><strong>${money(salePrice(product) * quantity)}</strong>${productDiscountPercentage(product) > 0 ? `<del>${money(product.price * quantity)}</del>` : ""}<button class="remove-item" data-remove="${escapeHTML(key)}">Remove</button></div>
    </article>`;
  }).join("");
  $("#cartEmpty").classList.toggle("hidden", count > 0);
  $("#cartSummary").classList.toggle("hidden", count === 0);
  $("#cartOriginalSubtotal").textContent = money(originalSubtotal);
  $("#cartSavings").textContent = `−${money(originalSubtotal - subtotal)}`;
  $("#cartSubtotal").textContent = money(subtotal);
}

function renderWishlist() {
  const savedProducts = products.filter((product) => favorites.has(product.id));
  $("#wishlistCount").textContent = savedProducts.length;
  $("#wishlistItemCount").textContent = `(${savedProducts.length})`;
  $("#wishlistItems").innerHTML = savedProducts.map((product) => `
    <article class="wishlist-line">
      <img src="${escapeHTML(product.image)}" alt="">
      <div class="wishlist-line-info">
        <div class="wishlist-line-name">${escapeHTML(product.name)}</div>
        <div class="wishlist-line-price">${money(salePrice(product))}</div>
        <div class="wishlist-line-actions">
          <button type="button" data-wishlist-view="${escapeHTML(product.id)}">View details</button>
          <button type="button" data-wishlist-remove="${escapeHTML(product.id)}">Remove</button>
        </div>
      </div>
    </article>`).join("");
  $("#wishlistEmpty").classList.toggle("hidden", savedProducts.length > 0);
}

function openCart() {
  closeWishlist();
  $("#cartDrawer").classList.add("open");
  $("#cartDrawer").setAttribute("aria-hidden", "false");
  $("#drawerScrim").classList.remove("hidden");
}
function closeCart() {
  $("#cartDrawer").classList.remove("open");
  $("#cartDrawer").setAttribute("aria-hidden", "true");
  if (!$("#wishlistDrawer").classList.contains("open")) $("#drawerScrim").classList.add("hidden");
}
function requestWishlistSignup(productId = "") {
  pendingWishlistOpen = true;
  pendingWishlistProductId = productId;
  accountMode = "register";
  openLogin();
  $("#loginIntro").textContent = "Create an account to save your wishlist across devices.";
}
async function openWishlist() {
  if (!accountSessionLoaded && !await loadAccountSession()) {
    showToast(accountSessionError);
    return;
  }
  if (!account) {
    requestWishlistSignup();
    return;
  }
  if (!accountWishlistLoaded) {
    try {
      await syncAccountWishlist();
    } catch (error) {
      showToast(error.message);
      return;
    }
  }
  closeCart();
  renderWishlist();
  $("#wishlistDrawer").classList.add("open");
  $("#wishlistDrawer").setAttribute("aria-hidden", "false");
  $("#drawerScrim").classList.remove("hidden");
}
function closeWishlist() {
  $("#wishlistDrawer").classList.remove("open");
  $("#wishlistDrawer").setAttribute("aria-hidden", "true");
  if (!$("#cartDrawer").classList.contains("open")) $("#drawerScrim").classList.add("hidden");
}
function openLogin() {
  $("#loginModal").classList.remove("hidden");
  renderAccountDialog();
  if (!account && accountSessionError) $("#loginMessage").textContent = accountSessionError;
  else if (account) $("#signOutButton").focus();
  else $("#loginIdentifier").focus();
}
function setAccountMode(mode) {
  accountMode = mode;
  const registering = mode === "register";
  $("#accountSignedIn").classList.add("hidden");
  $("#loginForm").classList.toggle("hidden", Boolean(account));
  $("#loginSwitch").classList.toggle("hidden", Boolean(account));
  $("#loginEyebrow").textContent = registering ? "A PLACE OF YOUR OWN" : "WELCOME BACK";
  $("#loginTitle").textContent = registering ? "Create your account" : "Sign in to your account";
  $("#loginIntro").textContent = registering
    ? "Save your details and enjoy a more personal edit."
    : "Pick up where you left off.";
  $("#loginNameLabel").classList.toggle("hidden", !registering);
  $("#loginName").classList.toggle("hidden", !registering);
  $("#loginName").required = registering;
  $("#loginPasswordConfirmLabel").classList.toggle("hidden", !registering);
  $("#loginPasswordConfirm").classList.toggle("hidden", !registering);
  $("#loginPasswordConfirm").required = registering;
  $("#loginPassword").autocomplete = registering ? "new-password" : "current-password";
  $("#loginOptions").classList.remove("hidden");
  $("#loginForm button[type='submit']").innerHTML = registering
    ? "Create account <span>→</span>"
    : "Sign in <span>→</span>";
  $("#loginSwitch").innerHTML = registering
    ? 'Already have an account? <button type="button" class="text-button" id="createAccount">Sign in</button>'
    : 'New to HNM Atelier? <button type="button" class="text-button" id="createAccount">Create an account</button>';
  $("#loginMessage").textContent = "";
  $("#loginPassword").value = "";
  $("#loginPasswordConfirm").value = "";
}
function renderAccountDialog() {
  if (account) {
    $("#loginEyebrow").textContent = "YOUR ATELIER ACCOUNT";
    $("#loginTitle").textContent = "Welcome, " + account.name;
    $("#loginIntro").textContent = "Your account is ready whenever you are.";
    $("#accountGreeting").textContent = account.name;
    $("#accountEmail").textContent = account.email || account.phone;
    $("#loginForm").classList.add("hidden");
    $("#loginSwitch").classList.add("hidden");
    $("#accountSignedIn").classList.remove("hidden");
    return;
  }
  $("#accountSignedIn").classList.add("hidden");
  $("#loginForm").classList.remove("hidden");
  $("#loginSwitch").classList.remove("hidden");
  setAccountMode(accountMode);
}
function updateAccount(accountInfo) {
  account = accountInfo;
  const accountButton = $("#accountButton");
  accountButton.setAttribute("aria-label", account ? `Account for ${account.name}` : "Sign in");
  accountButton.title = account ? account.name : "Sign in";
  if (account) {
    const nameField = $("#checkoutForm [name='name']");
    const emailField = $("#checkoutForm [name='email']");
    const phoneField = $("#checkoutForm [name='phone']");
    if (!nameField.value) nameField.value = account.name;
    if (!emailField.value && account.email) emailField.value = account.email;
    if (!phoneField.value && account.phone) phoneField.value = account.phone;
  }
}
async function syncAccountWishlist() {
  const result = await apiRequest("/api/account/wishlist");
  if (!Array.isArray(result.productIds)) throw new Error("The saved wishlist response is invalid.");
  const productIds = new Set([...result.productIds, ...guestFavorites]);
  if (pendingWishlistProductId) productIds.add(pendingWishlistProductId);
  const mergedIds = [...productIds];
  if (mergedIds.length > 100) {
    throw new Error("Your wishlist can save up to 100 products. Remove some items and try again.");
  }
  if (mergedIds.length !== result.productIds.length ||
      mergedIds.some((id, index) => id !== result.productIds[index])) {
    await apiRequest("/api/account/wishlist", {
      method: "PUT",
      body: JSON.stringify({ productIds: mergedIds })
    });
  }
  favorites = new Set(mergedIds);
  guestFavorites.clear();
  saveStore("forme-favorites", mergedIds);
  renderProducts();
  accountWishlistLoaded = true;
}
async function setWishlistMembership(id, shouldSave) {
  const previous = new Set(favorites);
  if (shouldSave) favorites.add(id);
  else favorites.delete(id);
  const productIds = [...favorites];
  saveStore("forme-favorites", productIds);
  renderProducts();
  try {
    const result = await apiRequest("/api/account/wishlist", {
      method: "PUT",
      body: JSON.stringify({ productIds })
    });
    favorites = new Set(result.productIds);
    saveStore("forme-favorites", result.productIds);
    renderProducts();
  } catch (error) {
    favorites = previous;
    saveStore("forme-favorites", [...favorites]);
    renderProducts();
    showToast(error.message);
  }
}
async function loadAccountSession() {
  try {
    const result = await apiRequest("/api/account/session");
    updateAccount(result.account);
    accountSessionError = "";
    accountSessionLoaded = true;
    if (account) {
      await syncAccountWishlist();
    } else {
      favorites.clear();
      saveStore("forme-favorites", []);
      renderProducts();
    }
    return true;
  } catch (error) {
    accountSessionError = "We couldn't check your account right now. Please try again.";
    console.error("Could not load customer account session:", error);
    return false;
  }
}
function applyStoreSettings() {
  $("#announcementText").textContent = settings.announcement;
  $("#announcementBar").classList.toggle("hidden", !settings.announcement);
  const headline = settings.heroTitle.replace(/\s+/g, " ").trim().split(" ");
  const midpoint = Math.ceil(headline.length / 2);
  $("#heroTitle").innerHTML = `${escapeHTML(headline.slice(0, midpoint).join(" "))}<br>${escapeHTML(headline.slice(midpoint).join(" "))}`;
  $("#heroSubtitle").textContent = settings.heroSubtitle;
  const heroImages = [
    ["#heroImage1", settings.heroImage],
    ["#heroImage2", settings.heroImage2],
    ["#heroImage3", settings.heroImage3]
  ];
  const hero = $("#hero");
  hero.style.removeProperty("aspect-ratio");
  hero.dataset.aspectImageUrl = "";
  let firstVisibleSlide = true;
  for (const [selector, imageUrl] of heroImages) {
    const image = $(selector);
    const url = typeof imageUrl === "string" ? imageUrl.trim() : "";
    image.hidden = !url;
    image.classList.toggle("is-active", Boolean(url) && firstVisibleSlide);
    image.classList.remove("is-leaving");
    if (url) {
      if (firstVisibleSlide) {
        hero.dataset.aspectImageUrl = url;
        image.addEventListener("load", () => {
          if (hero.dataset.aspectImageUrl === url && image.naturalWidth && image.naturalHeight) {
            hero.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
          }
        }, { once: true });
      }
      image.src = url;
      firstVisibleSlide = false;
    } else {
      image.removeAttribute("src");
    }
  }
  heroSlideIndex = 0;
  $("#hero").classList.toggle("no-image", firstVisibleSlide);
  const categories = Array.isArray(settings.headerCategories) && settings.headerCategories.length === 3
    ? settings.headerCategories
    : ["Ladies", "Home", "Beauty"];
  const categoryImages = Array.isArray(settings.categoryImages) && settings.categoryImages.length === 3
    ? settings.categoryImages
    : [
      "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=800&q=85",
      "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=800&q=85",
      "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=800&q=85"
    ];
  $("#categoryNav").innerHTML = categories.map((category, index) =>
    `<a class="${index === 0 ? "active" : ""}" href="#shop">${escapeHTML(category)}</a>`
  ).join("") + `<a href="#winterCollection" data-winter-collection>WINTER EDIT</a>`;
  $("#departmentGrid").innerHTML = categories.map((category, index) =>
    `<a class="department-card" href="#shop" data-department="${escapeHTML(category)}"><img src="${escapeHTML(categoryImages[index])}" alt="" loading="lazy"><span>${escapeHTML(category)}<b aria-hidden="true">↗</b></span></a>`
  ).join("");
}

async function loadStorefront() {
  storeLoadError = "";
  try {
    const data = await apiRequest("/api/storefront");
    if (!Array.isArray(data.products) || !data.settings) throw new Error("The store response is invalid.");
    products = data.products;
    settings = data.settings;
    applyStoreSettings();
  } catch (error) {
    console.error("Unable to load HNM Atelier storefront from MongoDB.", error);
    storeLoadError = "The HNM Atelier collection is unavailable. Start the server and check the MongoDB connection in .env.";
  }
  renderProducts();
  renderCart();
}

const revealObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -35px 0px" })
  : null;
if (!reducedMotionPreference.matches && revealObserver) {
  document.documentElement.classList.add("reveal-ready");
  observeReveal(document.querySelectorAll(".quick-category-heading, .quick-categories, .winter-heading, .department-heading, .category-strip, .section-heading, .shop-toolbar, .site-footer"));
}

$("main").addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add-cart]");
  const favoriteButton = event.target.closest("[data-favorite]");
  const imageButton = event.target.closest("[data-product-image]");
  if (addButton) addToCart(addButton.dataset.addCart);
  const productButton = event.target.closest("[data-product-open]");
  if (productButton && !favoriteButton && !imageButton) openProductDetails(productButton.dataset.productOpen);
  if (imageButton) {
    const product = products.find((item) => item.id === imageButton.dataset.productImage);
    const image = product?.images?.[Number(imageButton.dataset.productImageIndex)];
    if (image) {
      document.querySelectorAll("[data-product-main-image]").forEach((mainImage) => {
        if (mainImage.dataset.productMainImage === product.id) mainImage.src = image;
      });
      imageButton.parentElement.querySelectorAll(".product-image-thumb").forEach((thumb) => thumb.classList.toggle("active", thumb === imageButton));
    }
  }
  if (favoriteButton) {
    const id = favoriteButton.dataset.favorite;
    if (!account) {
      requestWishlistSignup(id);
      return;
    }
    setWishlistMembership(id, !favorites.has(id));
  }
});
$("main").addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("img[data-product-open]")) {
    event.preventDefault();
    openProductDetails(event.target.dataset.productOpen);
  }
});
$("#productDetailsModal").addEventListener("click", (event) => {
  if (event.target === $("#productDetailsModal") || event.target.closest("[data-close-product]")) {
    closeProductDetails();
    return;
  }
  const sizeGuide = event.target.closest("[data-size-guide]");
  if (sizeGuide) {
    const note = $("#productDetailsModal .size-guide-note");
    note.hidden = !note.hidden;
    sizeGuide.setAttribute("aria-expanded", String(!note.hidden));
    return;
  }
  const sizeButton = event.target.closest("[data-product-size]");
  if (sizeButton) {
    selectedProductSize = sizeButton.dataset.productSize;
    $("#productDetailsModal").querySelectorAll("[data-product-size]").forEach((button) => {
      button.classList.toggle("selected", button === sizeButton);
      button.setAttribute("aria-pressed", String(button === sizeButton));
    });
    $("#productSizeMessage").textContent = "";
    return;
  }
  const imageButton = event.target.closest("[data-detail-image]");
  if (imageButton) {
    const product = products.find((item) => item.id === selectedProductId);
    const image = product?.images?.[Number(imageButton.dataset.detailImage)];
    if (image) {
      $("#productDetailsModal .product-detail-image").src = image;
      $("#productDetailsModal").querySelectorAll("[data-detail-image]").forEach((button) => button.classList.toggle("active", button === imageButton));
    }
    return;
  }
  if (event.target.closest("#productDetailAdd")) {
    const product = products.find((item) => item.id === selectedProductId);
    if (product?.category === "Clothing" && !selectedProductSize) {
      $("#productSizeMessage").textContent = "Please select a size before adding this item to your bag.";
      $("#productDetailsModal [data-product-size]")?.focus();
      return;
    }
    if (product) addToCart(product.id, selectedProductSize);
  }
});
$("#productDetailsContent").addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeProductDetails();
});
$("#categoryNav").addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (!link) return;
  event.preventDefault();
  if (link.hasAttribute("data-winter-collection")) {
    $("#categoryNav").querySelectorAll("a").forEach((item) => item.classList.toggle("active", item === link));
    scrollToSection($("#winterCollection"));
    return;
  }
  setDepartment(link.textContent.trim());
  scrollToSection($("#shop"));
});
$("#departmentGrid").addEventListener("click", (event) => {
  const card = event.target.closest(".department-card");
  if (!card) return;
  event.preventDefault();
  setDepartment(card.dataset.department);
  scrollToSection($("#shop"));
});
$(".site-footer").addEventListener("click", (event) => {
  const departmentLink = event.target.closest("[data-footer-department]");
  const categoryLink = event.target.closest("[data-footer-category]");
  if (departmentLink) {
    event.preventDefault();
    setDepartment(departmentLink.dataset.footerDepartment);
    scrollToSection($("#shop"));
  }
  if (categoryLink) {
    event.preventDefault();
    $("#productSearch").value = "";
    quickCategoryReturnDepartment = activeDepartment;
    activeDepartment = "All";
    activeQuickCategory = categoryLink.dataset.footerCategory;
    renderProducts();
    scrollToSection($("#shop"));
  }
  if (event.target.closest("[data-footer-account]")) openLogin();
  if (event.target.closest("[data-footer-wishlist]")) openWishlist();
});
$("#footerSignup").addEventListener("click", () => {
  accountMode = "register";
  openLogin();
});
$("#quickCategories").addEventListener("click", (event) => {
  const category = event.target.closest("[data-quick-category]");
  if (!category) return;
  event.preventDefault();
  $("#productSearch").value = "";
  if (!activeQuickCategory) quickCategoryReturnDepartment = activeDepartment;
  activeQuickCategory = category.dataset.quickCategory;
  activeDepartment = "All";
  $("#categoryNav").querySelectorAll("a").forEach((item) => item.classList.remove("active"));
  renderProducts();
  scrollToSection($("#shop"));
});
$("#backToCollection").addEventListener("click", () => {
  setDepartment(quickCategoryReturnDepartment);
  scrollToSection($("#shop"));
});
$("#productSearch").addEventListener("input", () => {
  activeQuickCategory = "";
  renderProducts();
});
$("#searchToggle").addEventListener("click", () => {
  $("#productSearch").focus();
  scrollToSection($("#shop"));
});
$("#viewAllLink").addEventListener("click", () => setDepartment("All"));
$("#winterShopLink").addEventListener("click", (event) => {
  event.preventDefault();
  setDepartment("Ladies");
  scrollToSection($("#shop"));
});
$("#accountButton").addEventListener("click", openLogin);
$("#loginModal").addEventListener("click", (event) => {
  if (event.target === $("#loginModal") || event.target.closest("[data-close-modal]")) $("#loginModal").classList.add("hidden");
});
$("#loginSwitch").addEventListener("click", (event) => {
  if (event.target.closest("#createAccount")) {
    setAccountMode(accountMode === "signin" ? "register" : "signin");
    $("#loginIdentifier").focus();
  }
});
$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const registering = accountMode === "register";
  const name = $("#loginName").value.trim();
  const identifier = $("#loginIdentifier").value.trim();
  const password = $("#loginPassword").value;
  if (registering && password !== $("#loginPasswordConfirm").value) {
    $("#loginMessage").textContent = "The passwords don't match.";
    $("#loginPasswordConfirm").focus();
    return;
  }
  const submitButton = $("#loginForm button[type='submit']");
  submitButton.disabled = true;
  $("#loginMessage").textContent = "";
  try {
    const result = await apiRequest(registering ? "/api/account/register" : "/api/account/login", {
      method: "POST",
      body: JSON.stringify({
        ...(registering ? { name } : {}),
        identifier,
        password,
        rememberMe: $("#rememberMe").checked
      })
    });
    updateAccount(result.account);
    accountSessionError = "";
    accountSessionLoaded = true;
    renderAccountDialog();
    try {
      await syncAccountWishlist();
    } catch (error) {
      $("#accountMessage").textContent = `Your account is ready, but the wishlist could not be saved: ${error.message}`;
      return;
    }
    if (pendingWishlistOpen) {
      pendingWishlistOpen = false;
      pendingWishlistProductId = "";
      $("#loginModal").classList.add("hidden");
      openWishlist();
    }
  } catch (error) {
    $("#loginMessage").textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});
$("#accountSignedIn").addEventListener("click", async (event) => {
  if (!event.target.closest("#signOutButton")) return;
  const signOutButton = $("#signOutButton");
  signOutButton.disabled = true;
  $("#accountMessage").textContent = "";
  try {
    await apiRequest("/api/account/logout", { method: "POST", body: "{}" });
    updateAccount(null);
    accountSessionLoaded = true;
    accountWishlistLoaded = false;
    favorites.clear();
    guestFavorites.clear();
    saveStore("forme-favorites", []);
    renderProducts();
    setAccountMode("signin");
    $("#loginMessage").textContent = "You have signed out.";
    $("#loginIdentifier").focus();
  } catch (error) {
    $("#accountMessage").textContent = error.message;
  } finally {
    signOutButton.disabled = false;
  }
});
$("#cartButton").addEventListener("click", openCart);
$("#closeCart").addEventListener("click", closeCart);
$("#drawerScrim").addEventListener("click", () => {
  closeCart();
  closeWishlist();
});
$("#continueShopping").addEventListener("click", closeCart);
$("#wishlistButton").addEventListener("click", openWishlist);
$("#closeWishlist").addEventListener("click", closeWishlist);
$("#continueWishlist").addEventListener("click", closeWishlist);
$("#wishlistItems").addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-wishlist-remove]");
  const viewButton = event.target.closest("[data-wishlist-view]");
  if (removeButton) {
    setWishlistMembership(removeButton.dataset.wishlistRemove, false);
  }
  if (viewButton) {
    const id = viewButton.dataset.wishlistView;
    closeWishlist();
    openProductDetails(id);
  }
});
$("#cartItems").addEventListener("click", (event) => {
  const quantity = event.target.closest("[data-quantity]");
  const remove = event.target.closest("[data-remove]");
  if (quantity) updateCartQuantity(quantity.dataset.quantity, Number(quantity.dataset.change));
  if (remove) {
    delete cart[remove.dataset.remove];
    saveStore("forme-cart", cart);
    renderCart();
  }
});
$("#checkoutButton").addEventListener("click", () => {
  $("#checkoutForm").classList.remove("hidden");
  $("#checkoutButton").classList.add("hidden");
  $("#checkoutForm [name='name']").focus();
});
$("#checkoutForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const items = currentCartEntries().map(({ id: productId, quantity, size }) => ({
    productId,
    quantity,
    ...(size ? { size } : {})
  }));
  const submitButton = $("#placeOrderButton");
  const message = $("#checkoutMessage");
  submitButton.disabled = true;
  message.textContent = "";
  try {
    const result = await apiRequest("/api/payments/watchpays", {
      method: "POST",
      body: JSON.stringify({
        customer: {
          name: formData.get("name"),
          email: formData.get("email"),
          phone: formData.get("phone")
        },
        shippingAddress: {
          line1: formData.get("line1"),
          line2: formData.get("line2"),
          city: formData.get("city"),
          region: formData.get("region"),
          postalCode: formData.get("postalCode"),
          country: formData.get("country")
        },
        items
      })
    });
    window.location.assign(result.paymentUrl);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});
$("#closeAnnouncement").addEventListener("click", () => $("#announcementBar").classList.add("hidden"));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    $("#loginModal").classList.add("hidden");
    closeProductDetails();
    closeCart();
    closeWishlist();
  }
});

loadStorefront();
loadAccountSession();
startHeroSlideTimer();
reducedMotionPreference.addEventListener("change", (event) => {
  if (event.matches) stopHeroSlideTimer();
  else startHeroSlideTimer();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    loadStorefront();
    startHeroSlideTimer();
  } else {
    stopHeroSlideTimer();
  }
});
