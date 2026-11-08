const FormeStoreData = (() => {
  const initialProducts = [
    { id: "p2", name: "Relaxed Linen Trouser", department: "Ladies", category: "Clothing", price: 2899, stock: 18, badge: "JUST IN", image: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=900&q=85" },
    { id: "p4", name: "Everywhere Tote", department: "Ladies", category: "Accessories", price: 1599, stock: 31, badge: "", image: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=85" },
    {
      id: "p9", name: "BRUSHED V-NECK CARDIGAN", department: "Ladies", category: "Clothing", price: 2799, stock: 10, badge: "XS-XL",
      image: "/product-images/brushed-v-neck-cardigan-1.png",
      images: [1, 2, 3, 4, 5].map((number) => `/product-images/brushed-v-neck-cardigan-${number}.png`)
    },
    { id: "p13", name: "Linen Cushion Cover", department: "Home", category: "Home", price: 899, stock: 30, badge: "", image: "https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?auto=format&fit=crop&w=900&q=85" },
    { id: "p14", name: "Everyday Ceramic Vase", department: "Home", category: "Home", price: 1299, stock: 14, badge: "JUST IN", image: "https://images.unsplash.com/photo-1578500494198-246f612d3b3d?auto=format&fit=crop&w=900&q=85" },
    { id: "p15", name: "Daily Hydration Cream", department: "Beauty", category: "Beauty", price: 699, stock: 35, badge: "", image: "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=900&q=85" },
    { id: "p16", name: "Nourishing Lip Balm", department: "Beauty", category: "Beauty", price: 399, stock: 40, badge: "BESTSELLER", image: "https://images.unsplash.com/photo-1601049541289-9b1b7bbbfe19?auto=format&fit=crop&w=900&q=85" },
    {
      id: "p17", name: "FAUX FUR COAT", department: "Ladies", category: "Clothing", price: 1890, stock: 10, badge: "NEW",
      image: "/product-images/faux-fur-coat-1.png",
      images: [1, 2, 3, 4].map((number) => `/product-images/faux-fur-coat-${number}.png`)
    },
    {
      id: "p18", name: "Faux Shearling Buckle Detail Aviator Jacket", department: "Ladies", category: "Clothing", price: 3999, stock: 10, badge: "NEW",
      image: "/product-images/faux-shearling-aviator-jacket-1.png",
      images: [1, 2, 3, 4].map((number) => `/product-images/faux-shearling-aviator-jacket-${number}.png`)
    },
    {
      id: "p19", name: "Stretchable Ribbed Flared Peplum Top", department: "Ladies", category: "Clothing", quickCategory: "tops", price: 980, stock: 10, badge: "NEW",
      image: "/product-images/stretchable-ribbed-flared-peplum-top-1.png",
      images: [1, 2, 3, 4].map((number) => `/product-images/stretchable-ribbed-flared-peplum-top-${number}.png`)
    },
    {
      id: "p20", name: "Shells Beaded Ribbed Tank Top", department: "Ladies", category: "Clothing", quickCategory: "tops", price: 1280, stock: 10, badge: "NEW",
      image: "/product-images/shells-beaded-ribbed-tank-top-1.png",
      images: [1, 2, 3, 4, 5].map((number) => `/product-images/shells-beaded-ribbed-tank-top-${number}.png`)
    },
    {
      id: "p21", name: "Moo'd Swing Cotton Tee", department: "Ladies", category: "Clothing", quickCategory: "tops", price: 850, stock: 10, badge: "NEW",
      image: "/product-images/mood-swing-cotton-tee-1.png",
      images: [1, 2, 3, 4, 5].map((number) => `/product-images/mood-swing-cotton-tee-${number}.png`)
    },
    {
      id: "p22", name: "Half Sleeve Contrast Raglan Tee", department: "Ladies", category: "Clothing", quickCategory: "tops", price: 1699, stock: 10, badge: "NEW",
      image: "/product-images/half-sleeve-contrast-raglan-tee-1.png",
      images: [1, 2, 3, 4].map((number) => `/product-images/half-sleeve-contrast-raglan-tee-${number}.png`)
    },
    {
      id: "p23", name: "TRF BAGGY OVERSIZE MID-WAIST JEANS WITH SEAM DETAIL", department: "Ladies", category: "Clothing", quickCategory: "baggy-pants", price: 3950, stock: 10, badge: "NEW",
      image: "/product-images/trf-baggy-oversize-mid-waist-jeans-with-seam-detail-1.png",
      images: [1, 2, 3, 4].map((number) => `/product-images/trf-baggy-oversize-mid-waist-jeans-with-seam-detail-${number}.png`)
    }
  ];
  const initialOrders = [
    { id: "FM-1048", customer: "Avery Morgan", date: "Nov 07, 2026", total: 174, status: "Processing" },
    { id: "FM-1047", customer: "Jordan Lee", date: "Nov 06, 2026", total: 96, status: "Shipped" },
    { id: "FM-1046", customer: "Casey Patel", date: "Nov 06, 2026", total: 232, status: "Delivered" },
    { id: "FM-1045", customer: "Riley Chen", date: "Nov 05, 2026", total: 54, status: "Processing" }
  ];

  function read(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      if (!value) return fallback;
      const parsed = JSON.parse(value);
      if (key === "forme-settings" && [
        "A little something extra: complimentary shipping on orders over $120",
        "THE DIWALI EDIT · Enjoy 20% off the collection, already reflected in your bag"
      ].includes(parsed.announcement)) {
        parsed.announcement = "A LITTLE SOMETHING EXTRA · Enjoy 20% off your edit, applied automatically";
        save(key, parsed);
      }
      return parsed;
    } catch (error) {
      console.error(`Unable to load ${key} from local storage.`, error);
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error(`Unable to save ${key} to local storage.`, error);
      return false;
    }
  }

  function money(amount) {
    const value = Number(amount);
    return `₹${value.toLocaleString("en-IN", {
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2
    })}`;
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  return { initialProducts, initialOrders, read, save, money, escapeHTML };
})();

if (typeof module !== "undefined" && module.exports) module.exports = FormeStoreData;
if (typeof window !== "undefined") window.FormeStoreData = FormeStoreData;
