// ── Endpoints ───────────────────────────────────────────────
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw8o3AhN6cWrhbCtDzRKmDROCGCAKDH8eZ4H2HlFz0mWGeqpcuCB_KgaWvnjsBq-r4n/exec';
const ORDER_API_URL = 'https://admin-pbc.vercel.app/api/orders';
const PRODUCTS_API_URL = 'https://admin-pbc.vercel.app/api/products';
const CATALOG_CACHE_KEY = 'prs_catalog_data';

// ── In-Memory Catalog Cache & Sync State ────────────────────
let cachedCatalogData = null;
let currentRenderedJSON = '';
let isSyncingCatalog = false;

// ── Cart / State Hook ───────────────────────────────────────
const cart = {};
const orders = [];
let paymentImageData = '';
let paymentImageName = '';

function iconBag(className = 'icon icon-sm') {
  return `<svg class="${className}" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path d="M6 7h13l-1.5 7.5a2 2 0 0 1-2 1.6H8a2 2 0 0 1-2-1.6L5 4H2" />
    <circle cx="9" cy="19" r="1.5" fill="currentColor" stroke="none"></circle>
    <circle cx="17" cy="19" r="1.5" fill="currentColor" stroke="none"></circle>
  </svg>`;
}

function iconCart(className = 'icon icon-sm') {
  return `<svg class="${className}" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path d="M4 6h2l1.2 8.5A2 2 0 0 0 9.2 16h8.2a2 2 0 0 0 1.9-1.5L21 8H7.5" />
    <circle cx="10" cy="19" r="1.5" fill="currentColor" stroke="none"></circle>
    <circle cx="18" cy="19" r="1.5" fill="currentColor" stroke="none"></circle>
  </svg>`;
}

function iconX(className = 'icon icon-sm') {
  return `<svg class="${className}" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path d="m7 7 10 10M17 7 7 17" />
  </svg>`;
}

let shippingConfig = {
  luzon: { 1: 80, 2: 95, max: 120 },
  visayas: { 1: 100, 2: 140, max: 180 },
  mindanao: { 1: 120, 2: 180, max: 210 },
  other: { 1: 0, 2: 0, max: 0 }
};
let selectedRegion = ""; 
let selectedShippingCost = 0;
let activeCategory = "all";
let catalogCategories = [];

function getTotalItemCount() {
  let totalPcs = 0;
  
  Object.values(cart).forEach(item => {
    totalPcs += item.qty;
  });
  
  orders.forEach(order => {
    if (order.items) {
      order.items.forEach(item => {
        totalPcs += item.quantity || 1;
      });
    }
  });

  return totalPcs;
}

// ── Dynamic Shipping Calculator ──────────────────────────────
function calculateDynamicShipping() {
  const totalItems = getTotalItemCount();
  const regions = ["luzon", "visayas", "mindanao", "other"];

  if (totalItems === 0) {
    selectedRegion = "";
    selectedShippingCost = 0;
    
    document.querySelectorAll('.shipping-option').forEach(btn => btn.classList.remove('active'));
    
    regions.forEach(r => {
      const el = document.getElementById(`ship${r.charAt(0).toUpperCase() + r.slice(1)}`) ||
                 document.querySelector(`[onclick="selectShipping('${r}')"] span:last-child`);
      if (el) {
        el.innerText = "₱0";
      }
    });
    return;
  }

  regions.forEach(r => {
    const el = document.getElementById(`ship${r.charAt(0).toUpperCase() + r.slice(1)}`) ||
               document.querySelector(`[onclick="selectShipping('${r}')"] span:last-child`);

    if (el && shippingConfig[r]) {
      const count = totalItems <= 1 ? "1" : (totalItems === 2 ? "2" : "max");
      const rate = shippingConfig[r][count] !== undefined
        ? shippingConfig[r][count]
        : (shippingConfig[r].max !== undefined ? shippingConfig[r].max : (typeof shippingConfig[r] === 'number' ? shippingConfig[r] : 0));
      el.innerText = `₱${rate}`;
    }
  });

  if (selectedRegion && shippingConfig[selectedRegion]) {
    const count = totalItems <= 1 ? "1" : (totalItems === 2 ? "2" : "max");
    selectedShippingCost = shippingConfig[selectedRegion][count] !== undefined
      ? shippingConfig[selectedRegion][count]
      : (shippingConfig[selectedRegion].max !== undefined ? shippingConfig[selectedRegion].max : (typeof shippingConfig[selectedRegion] === 'number' ? shippingConfig[selectedRegion] : 0));
  } else {
    selectedShippingCost = 0;
  }
}

function scrollCatalogToTop() {
  const catalog = document.getElementById('productCatalog');
  if (catalog) {
    const shell = document.querySelector('.top-shell');
    const shellHeight = shell ? shell.getBoundingClientRect().height : 0;
    const top = catalog.getBoundingClientRect().top + window.pageYOffset - shellHeight - 16;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
}

function scrollToCheckout() {
  const checkout = document.querySelector('.order-panel');
  if (checkout) {
    checkout.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function updateCheckoutAffordances(grandTotal) {
  const count = getTotalItemCount();
  const headerSummary = document.getElementById('headerSummary');
  const orderCountBadge = document.getElementById('orderCountBadge');
  const mobileBar = document.getElementById('mobileCheckoutBar');
  const mobileCount = document.getElementById('mobileCheckoutCount');
  const mobileTotal = document.getElementById('mobileCheckoutTotal');
  const paymentSendAmount = document.getElementById('paymentSendAmount');

  if (headerSummary) {
    headerSummary.innerHTML = `<span class="header-summary-icon">${iconBag('icon icon-sm')}</span><span>${count}</span>`;
  }
  if (orderCountBadge) {
    orderCountBadge.textContent = count;
  }

  if (mobileBar && mobileCount && mobileTotal) {
    const hasItems = grandTotal > 0;
    mobileBar.classList.toggle('show', hasItems);
    document.body.classList.toggle('has-mobile-checkout', hasItems);
    mobileCount.textContent = count;
    mobileTotal.textContent = `₱${grandTotal.toLocaleString()}`;
  }

  if (paymentSendAmount) {
    paymentSendAmount.textContent = `₱${grandTotal.toLocaleString()}`;
  }
}

function applyCatalogFilters() {
  const query = document.getElementById('searchInput').value.trim().toLowerCase();
  const groups = document.querySelectorAll('#productCatalog .product-group');

  groups.forEach(group => {
    const groupCategory = (group.dataset.category || '').toLowerCase();
    const cards = group.querySelectorAll('.product-card');
    let hasVisible = false;

    cards.forEach(card => {
      const matchesCategory = activeCategory === 'all' || groupCategory === activeCategory;
      const matchesSearch = !query || card.dataset.name.toLowerCase().includes(query);
      const visible = matchesCategory && matchesSearch;
      card.style.display = visible ? '' : 'none';
      if (visible) hasVisible = true;
    });

    group.style.display = hasVisible ? '' : 'none';
  });
}

function renderCategoryPills() {
  const strip = document.getElementById('categoryStrip');
  if (!strip) return;

  const pillValues = ['all', ...catalogCategories.map(l => l.toLowerCase())];
  if (!pillValues.includes(activeCategory)) {
    activeCategory = 'all';
  }

  const pills = [
    { label: 'All Products', value: 'all' },
    ...catalogCategories.map(label => ({
      label,
      value: label.toLowerCase()
    }))
  ];

  strip.innerHTML = pills.map(pill => `
    <button type="button" class="category-pill${pill.value === activeCategory ? ' active' : ''}" data-category="${pill.value}">${pill.label}</button>
  `).join('');

  strip.querySelectorAll('.category-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.category || 'all';
      strip.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      applyCatalogFilters();
      scrollCatalogToTop();
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const search = document.getElementById('searchInput');
  if (search) {
    search.addEventListener('focus', () => {
      if (window.innerWidth < 768) {
        scrollCatalogToTop();
      }
    });
  }
});

function selectShipping(region) {
  if (getTotalItemCount() === 0) {
    return; 
  }

  selectedRegion = region;

  document.querySelectorAll('.shipping-option').forEach(btn => btn.classList.remove('active'));
  
  const targetBtn = event.currentTarget || document.querySelector(`[onclick="selectShipping('${region}')"]`);
  if (targetBtn) targetBtn.classList.add('active');

  renderOrder();
}

// ── Toggle product selected / deselected ───────────────────
function toggleProduct(card) {
  const key = card.dataset.name;

  if (card.classList.contains('selected')) {
    card.classList.remove('selected');
    delete cart[key];
  } else {
    card.classList.add('selected');
    cart[key] = {
      name:  key,
      price: parseInt(card.dataset.price),
      qty:   1
    };
    card.querySelector('.qty-num').textContent = '1';
  }

  renderOrder();
}

// ── Change quantity ─────────────────────────────────────────
function changeQty(e, btn, delta) {
  e.stopPropagation();
  const card = btn.closest('.product-card');
  const key  = card.dataset.name;
  if (!cart[key]) return;

  cart[key].qty = Math.max(1, cart[key].qty + delta);
  card.querySelector('.qty-num').textContent = cart[key].qty;
  renderOrder();
}

// ── Render order summary panel ──────────────────────────────
function renderOrder() {
  const container = document.getElementById('orderItems');
  const keys      = Object.keys(cart);
  const ordersList = document.getElementById('ordersList');

  let currentTotal = 0;
  let html  = '';

  if (!keys.length) {
    html = `
      <div class="empty-state" id="emptyState">
        <div class="empty-state-icon">${iconCart('icon icon-lg')}</div>
        No items yet
        <small>Browse products and tap Add</small>
      </div>`;
  } else {
    keys.forEach(k => {
      const item = cart[k];
      const sub  = item.price * item.qty;
      const initials = item.name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
      currentTotal += sub;
      html += `
        <div class="order-item current-item">
          <div class="item-avatar">${initials}</div>
          <div class="item-info">
            <div class="item-row-top">
              <div class="item-name">${item.name}</div>
            </div>
            <div class="item-subtitle">${item.name}</div>
            <div class="item-qty">${item.qty} item${item.qty > 1 ? 's' : ''} · ₱${item.price.toLocaleString()} each</div>
            <div class="item-actions">
              <div class="qty-control" style="display:flex;">
                <button type="button" class="qty-btn" onclick="changeQty(event,this,-1)">−</button>
                <span class="qty-num">${item.qty}</span>
                <button type="button" class="qty-btn" onclick="changeQty(event,this,1)">+</button>
              </div>
              <button type="button" class="item-remove" aria-label="Remove item" onclick="toggleProduct(document.querySelector('.product-card[data-name=&quot;${item.name.replace(/"/g, '&quot;')}&quot;]'))">${iconX('icon icon-sm')}</button>
            </div>
          </div>
          <div class="item-price">₱${sub.toLocaleString()}</div>
        </div>`;
    });
  }

  container.innerHTML = html;

  let ordersHtml = '';
  if (orders.length) {
    orders.forEach((order, index) => {
      ordersHtml += `
        <div class="order-item order-item--previous">
          <div class="item-info">
            <div class="item-name">Order #${index + 1}</div>
          </div>
          <div class="item-price">₱${order.total.toLocaleString()}</div>
        </div>`;
    });
  } else {
    ordersHtml = '<div style="opacity: 0.6; font-size: 12px; text-align: center; padding: 18px 10px; color: var(--muted);">No previous orders</div>';
  }
  ordersList.innerHTML = ordersHtml;

  calculateDynamicShipping();

  updateTotals(currentTotal, calculateGrandTotal());
}

function updateTotals(currentTotal, grandTotal) {
  document.getElementById('totalAmount').textContent = grandTotal.toLocaleString();
  document.getElementById('submitBtn').disabled = grandTotal === 0 || !paymentImageData;
  updateCheckoutAffordances(grandTotal);
}

function calculateGrandTotal() {
  let grand = 0;
  
  orders.forEach(order => grand += order.total);
  Object.values(cart).forEach(item => {
    grand += item.price * item.qty;
  });
  
  grand += selectedShippingCost;
  
  return grand;
}

// ── Two-Step Checkout Submission (Drive Upload -> Next.js Intake) ──
async function submitOrder() {
  const name    = document.getElementById('custName').value.trim();
  const contact = document.getElementById('custContact').value.trim();
  const address = document.getElementById('custAddress').value.trim();
  const notes   = document.getElementById('custNotes').value.trim();

  if (!name || !contact) {
    alert('Please enter your name and contact details 💗');
    return;
  }

  if (!paymentImageData) {
    alert('Please upload your payment screenshot before submitting.');
    return;
  }

  if (orders.length === 0 && Object.keys(cart).length === 0) {
    alert('Please add some items to your order 💗');
    return;
  }

  const submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = '💗 Uploading Receipt...';

  let paymentProofUrl = '';

  // ── Step 1: Upload Receipt to Google Drive via Apps Script ──
  try {
    const drivePayload = {
      name,
      contact,
      address:   address || '—',
      notes:     notes || '—',
      imageName: paymentImageName || 'receipt.png',
      imageData: paymentImageData || ''
    };

    const driveRes = await fetch(GOOGLE_SCRIPT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body:    JSON.stringify(drivePayload)
    });

    const driveResult = await driveRes.json().catch(() => null);
    
    if (driveResult && (driveResult.url || driveResult.fileId || driveResult.paymentProofUrl)) {
      paymentProofUrl = driveResult.url || driveResult.fileId || driveResult.paymentProofUrl;
    } else if (driveResult && driveResult.id) {
      paymentProofUrl = driveResult.id;
    } else {
      paymentProofUrl = paymentImageName || 'uploaded_receipt';
    }
  } catch (driveErr) {
    console.warn('Google Drive receipt upload fallback:', driveErr);
    paymentProofUrl = paymentImageName || 'uploaded_receipt';
  }

  // ── Step 2: Submit Order Payload to Production Next.js API ──
  submitBtn.textContent = '💗 Submitting Order...';

  const formattedItems = [];

  orders.forEach(order => {
    if (order.items && Array.isArray(order.items)) {
      formattedItems.push(...order.items);
    } else if (order.itemLines && Array.isArray(order.itemLines)) {
      order.itemLines.forEach(line => {
        const match = line.match(/^(.*?)\s*[×x](\d+)\s*=\s*₱?([\d,]+)/);
        if (match) {
          const qty = parseInt(match[2], 10) || 1;
          const totalCents = parseFloat(match[3].replace(/,/g, '')) || 0;
          formattedItems.push({
            name: match[1].trim(),
            quantity: qty,
            price: Math.round(totalCents / qty)
          });
        } else {
          formattedItems.push({ name: line, quantity: 1, price: 0 });
        }
      });
    }
  });

  Object.values(cart).forEach(item => {
    formattedItems.push({
      name: item.name,
      quantity: item.qty,
      price: item.price
    });
  });

  const grandTotal = calculateGrandTotal();

  const apiPayload = {
    customerName:    name,
    customerPhone:   contact,
    deliveryAddress: address || '—',
    items:           formattedItems,
    shippingRegion:  selectedRegion || 'other',
    shippingFee:     selectedShippingCost,
    totalAmount:     grandTotal,
    notes:           notes || null,
    paymentProofUrl: paymentProofUrl
  };

  try {
    const apiRes = await fetch(ORDER_API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(apiPayload)
    });

    const apiData = await apiRes.json();

    if (apiRes.ok && apiData.success) {
      const orderRef = apiData.orderNumber ? ` (${apiData.orderNumber})` : '';
      document.getElementById('successMsg').textContent =
        `Thank you, ${name}! 🌸 Your order${orderRef} totalling ₱${grandTotal.toLocaleString()} has been received! We'll contact you at ${contact} shortly!`;
      document.getElementById('successOverlay').classList.add('show');
    } else {
      alert(`Order Submission Failed: ${apiData.error || 'Please try again 💗'}`);
    }
  } catch (apiErr) {
    console.error('Next.js API submission error:', apiErr);
    alert('Network error submitting order to backend. Please check your connection and try again.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '💗 Submit My Order 💗';
  }
}

function handlePaymentScreenshot(event) {
  const file = event.target.files[0];
  const previewEl = document.getElementById('imagePreview');
  const previewImg = document.getElementById('previewImg');

  if (!file) {
    paymentImageData = '';
    paymentImageName = '';
    previewEl.style.display = 'none';
    previewImg.src = '';
    renderOrder();
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    alert('Please choose an image smaller than 5MB.');
    event.target.value = '';
    renderOrder();
    return;
  }

  paymentImageName = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    paymentImageData = reader.result;
    previewImg.src = paymentImageData;
    previewEl.style.display = 'flex';
    renderOrder();
  };
  reader.readAsDataURL(file);
}

function removePaymentScreenshot() {
  const fileInput = document.getElementById('custImage');
  const previewEl = document.getElementById('imagePreview');
  const previewImg = document.getElementById('previewImg');

  fileInput.value = '';
  paymentImageData = '';
  paymentImageName = '';
  previewImg.src = '';
  previewEl.style.display = 'none';
  renderOrder();
}

// ── Close success modal & reset ─────────────────────────────
function closeSuccess() {
  document.getElementById('successOverlay').classList.remove('show');

  orders.length = 0;
  Object.keys(cart).forEach(k => delete cart[k]);
  selectedRegion = "";
  selectedShippingCost = 0;
  
  document.querySelectorAll('.shipping-option').forEach(btn => btn.classList.remove('active'));
  renderOrder();

  document.querySelectorAll('.product-card.selected')
    .forEach(c => c.classList.remove('selected'));

  ['custName', 'custContact', 'custAddress', 'custNotes']
    .forEach(id => document.getElementById(id).value = '');
  removePaymentScreenshot();
}

// ── Add current cart to orders list ────────────────────────
function addCurrentToOrders() {
  const keys = Object.keys(cart);
  if (keys.length === 0) {
    alert('No items in current cart 💗');
    return;
  }
  const orderTotal = Object.values(cart).reduce((sum, item) => sum + item.price * item.qty, 0);
  const items = keys.map(k => {
    const item = cart[k];
    return {
      name: item.name,
      quantity: item.qty,
      price: item.price
    };
  });
  orders.push({ total: orderTotal, items });

  Object.keys(cart).forEach(k => delete cart[k]);
  document.querySelectorAll('.product-card.selected').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.qty-num').forEach(span => span.textContent = '1');
  renderOrder();
}

function startNewOrder() {
  Object.keys(cart).forEach(k => delete cart[k]);
  document.querySelectorAll('.product-card.selected').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.qty-num').forEach(span => span.textContent = '1');
  renderOrder();
}

// ── Dynamic Master Database JSON / API Loader ───────────────
async function fetchCatalogData() {
  // 1. Network-First: Always attempt to fetch the live catalog first from PRODUCTS_API_URL
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 6000) : null;
    const response = await fetch(`${PRODUCTS_API_URL}?t=${Date.now()}`, {
      cache: "no-store",
      signal: controller ? controller.signal : undefined,
      headers: { 'Accept': 'application/json' }
    });
    if (timeoutId) clearTimeout(timeoutId);

    if (response && response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        cachedCatalogData = data;
        try {
          sessionStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(data));
        } catch (storageErr) {
          console.warn('Unable to write catalog to sessionStorage:', storageErr);
        }
        return data;
      }
    }
    throw new Error(`API returned non-ok or invalid data (${response ? response.status : 'unknown'})`);
  } catch (apiErr) {
    console.warn("Live API fetch failed. Falling back to cache or local catalog:", apiErr);
  }

  // 2. Fallback Behavior (Offline / Failure Only):
  // Check sessionStorage cache
  try {
    const cached = sessionStorage.getItem(CATALOG_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.info("Loaded catalog from sessionStorage fallback.");
        cachedCatalogData = parsed;
        return parsed;
      }
    }
  } catch (storageErr) {
    console.warn("Error reading from sessionStorage fallback:", storageErr);
  }

  // Check in-memory cache if available
  if (cachedCatalogData && Array.isArray(cachedCatalogData) && cachedCatalogData.length > 0) {
    console.info("Loaded catalog from in-memory fallback.");
    return cachedCatalogData;
  }

  // Fall back to bundled window.PRODUCT_CATALOG_DATA
  if (typeof window !== "undefined" && window.PRODUCT_CATALOG_DATA && Array.isArray(window.PRODUCT_CATALOG_DATA)) {
    console.info("Loaded catalog from bundled window.PRODUCT_CATALOG_DATA fallback.");
    cachedCatalogData = window.PRODUCT_CATALOG_DATA;
    return window.PRODUCT_CATALOG_DATA;
  }

  // Fall back to local products.json
  try {
    const response = await fetch("products.json");
    if (response && response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        console.info("Loaded catalog from local products.json fallback.");
        cachedCatalogData = data;
        return data;
      }
    }
  } catch (fetchErr) {
    console.warn("fetch('products.json') fallback failed:", fetchErr);
  }

  throw new Error("Unable to load product data via live API or fallbacks.");
}

function renderCatalog(productData) {
  const catalogContainer = document.getElementById("productCatalog");
  if (!catalogContainer || !Array.isArray(productData)) return;

  currentRenderedJSON = JSON.stringify(productData);

  catalogCategories = [];
  let catalogHTML = "";

  productData.forEach(group => {
    // INTERCEPT CONFIG
    if (group.type === "shipping_config" && group.rates) {
      shippingConfig = group.rates;
      return; 
    }

    if (group.category) {
      catalogCategories.push(group.category);
    }

    const pillHTML = group.pill ? `<span class="cat-pill">${group.pill}</span>` : "";
    
    catalogHTML += `
      <div class="product-group" data-group data-category="${group.category}">
        <div class="cat-header">
          <span class="cat-icon">${group.icon || '🛍️'}</span>
          <span class="cat-title">${group.category}</span>
          ${pillHTML}
        </div>
        <div class="product-grid">
    `;

    if (group.items && Array.isArray(group.items)) {
      group.items.forEach(item => {
        const itemPrice = Number(item.price) || 0;
        const itemEmoji = item.emoji || '💉';
        catalogHTML += `
          <div class="product-card" data-name="${item.fullName}" data-price="${itemPrice}" onclick="toggleProduct(this)">
            <div class="card-check" aria-hidden="true">
              <svg class="icon icon-sm" viewBox="0 0 24 24" stroke="currentColor">
                <path d="m5 12 4 4L19 6" />
              </svg>
            </div>
            <span class="card-emoji">${itemEmoji}</span>
            <div class="card-name">${item.name}</div>
            <div class="card-fullname">${item.fullName}</div>
            <div class="card-price">${itemPrice.toLocaleString()}</div>
            <div class="add-pill">+ Add</div>
            <div class="qty-control">
              <button class="qty-btn" onclick="changeQty(event,this,-1)">−</button>
              <span class="qty-num">1</span>
              <button class="qty-btn" onclick="changeQty(event,this,1)">+</button>
            </div>
          </div>
        `;
      });
    }

    catalogHTML += `
        </div>
      </div>
      <hr class="cat-divider">
    `;
  });

  catalogContainer.innerHTML = catalogHTML;
  renderCategoryPills();
  
  calculateDynamicShipping();
  applyCatalogFilters();

  // Restore cart selection state and preserve existing quantities without reset
  document.querySelectorAll('.product-card').forEach(card => {
    const name = card.dataset.name;
    if (cart[name]) {
      card.classList.add('selected');
      const newPrice = parseInt(card.dataset.price, 10);
      if (!isNaN(newPrice) && newPrice > 0) {
        cart[name].price = newPrice;
      }
      const qtyEl = card.querySelector('.qty-num');
      if (qtyEl) qtyEl.textContent = cart[name].qty;
    }
  });

  // Re-calculate order panel totals with latest prices/shipping
  renderOrder();
}

// ── Background Auto-Sync Helper ─────────────────────────────
async function syncCatalogInBackground() {
  if (isSyncingCatalog) return;
  isSyncingCatalog = true;

  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 6000) : null;
    const response = await fetch(`${PRODUCTS_API_URL}?t=${Date.now()}`, {
      cache: "no-store",
      signal: controller ? controller.signal : undefined,
      headers: { 'Accept': 'application/json' }
    });
    if (timeoutId) clearTimeout(timeoutId);

    if (response && response.ok) {
      const freshData = await response.json();
      if (Array.isArray(freshData) && freshData.length > 0) {
        const freshJSON = JSON.stringify(freshData);
        if (freshJSON !== currentRenderedJSON) {
          console.info("Live catalog update detected in background. Syncing storefront...");
          cachedCatalogData = freshData;
          try {
            sessionStorage.setItem(CATALOG_CACHE_KEY, freshJSON);
          } catch (storageErr) {
            console.warn('Unable to write catalog to sessionStorage:', storageErr);
          }
          renderCatalog(freshData);
        }
      }
    }
  } catch (syncErr) {
    console.warn("Background catalog auto-sync warning:", syncErr);
  } finally {
    isSyncingCatalog = false;
  }
}

async function loadProductsFromJSON() {
  // 1. Instant Render (Stale-While-Revalidate):
  // Check sessionStorage or in-memory cache for immediate 0ms paint
  let hasRendered = false;
  try {
    let initialData = cachedCatalogData;
    if (!initialData) {
      const cached = sessionStorage.getItem(CATALOG_CACHE_KEY);
      if (cached) {
        initialData = JSON.parse(cached);
      }
    }
    if (!initialData && typeof window !== "undefined" && window.PRODUCT_CATALOG_DATA) {
      initialData = window.PRODUCT_CATALOG_DATA;
    }
    if (initialData && Array.isArray(initialData) && initialData.length > 0) {
      cachedCatalogData = initialData;
      renderCatalog(initialData);
      hasRendered = true;
    }
  } catch (initErr) {
    console.warn("Initial sync render warning:", initErr);
  }

  // 2. Concurrently fetch fresh catalog from API
  try {
    const freshData = await fetchCatalogData();
    if (freshData && Array.isArray(freshData)) {
      const freshJSON = JSON.stringify(freshData);
      if (freshJSON !== currentRenderedJSON || !hasRendered) {
        console.info("Catalog updated from live API. Re-rendering storefront...");
        renderCatalog(freshData);
      }
    }
  } catch (error) {
    console.error("Hala, nag-error ang configuration rendering mapping:", error);
    if (!hasRendered && typeof window !== "undefined" && window.PRODUCT_CATALOG_DATA) {
      renderCatalog(window.PRODUCT_CATALOG_DATA);
    }
  }
}

// ── Search & Document Base Initialization Listener ──────────
document.addEventListener('DOMContentLoaded', () => {
  loadProductsFromJSON();

  document.getElementById('searchInput').addEventListener('input', function () {
    applyCatalogFilters();
  });

  // Auto-sync catalog in background whenever the customer returns to the tab
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncCatalogInBackground();
    }
  });

  // Auto-sync catalog in background every 60 seconds while active
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      syncCatalogInBackground();
    }
  }, 60000);
});

// ── Payment tab switcher ────────────────────────────────────
function showPayTab(btn, id) {
  document.querySelectorAll('.pay-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.pay-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('pay-' + id).classList.add('active');
}