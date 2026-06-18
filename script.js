const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw8o3AhN6cWrhbCtDzRKmDROCGCAKDH8eZ4H2HlFz0mWGeqpcuCB_KgaWvnjsBq-r4n/exec';

// ── Cart / State Hook ───────────────────────────────────────
const cart = {};
const orders = [];
let paymentImageData = '';
let paymentImageName = '';

let shippingConfig = {
  luzon: { 1: 80, 2: 95, max: 120 },
  visayas: { 1: 100, 2: 140, max: 180 },
  mindanao: { 1: 120, 2: 180, max: 210 },
  other: { 1: 0, 2: 0, max: 0 }
};
let selectedRegion = ""; 
let selectedShippingCost = 0;

function getTotalItemCount() {
  let totalPcs = 0;
  
  Object.values(cart).forEach(item => {
    totalPcs += item.qty;
  });
  
  orders.forEach(order => {
    if (order.itemLines) {
      order.itemLines.forEach(line => {
        const match = line.match(/×(\d+)/);
        if (match) {
          totalPcs += parseInt(match[1]) || 1;
        }
      });
    }
  });

  return totalPcs;
}

// ── Dynamic Shipping Calculator ──────────────────────────────
function calculateDynamicShipping() {
  const totalItems = getTotalItemCount();

  if (totalItems === 0) {
    selectedRegion = "";
    selectedShippingCost = 0;
    
    document.querySelectorAll('.shipping-option').forEach(btn => btn.classList.remove('active'));
    
    ["luzon", "visayas", "mindanao", "other"].forEach(r => {
      const el = document.getElementById(`ship${r.charAt(0).toUpperCase() + r.slice(1)}`);
      if (el) {
        el.innerText = "₱0";
      } else if (r === "other") {
        const otherBtn = document.querySelector(`[onclick="selectShipping('other')"] span`);
        if (otherBtn) otherBtn.innerText = "₱0";
      }
    });
    return;
  }

  ["luzon", "visayas", "mindanao", "other"].forEach(r => {
    let el = document.getElementById(`ship${r.charAt(0).toUpperCase() + r.slice(1)}`);
    if (!el && r === "other") {
      el = document.querySelector(`[onclick="selectShipping('other')"] span`);
    }

    if (el && shippingConfig[r]) {
      const count = totalItems <= 1 ? "1" : (totalItems === 2 ? "2" : "max");
      el.innerText = `₱${shippingConfig[r][count]}`;
    }
  });

  if (selectedRegion && shippingConfig[selectedRegion]) {
    const count = totalItems <= 1 ? "1" : (totalItems === 2 ? "2" : "max");
    selectedShippingCost = shippingConfig[selectedRegion][count];
  } else {
    selectedShippingCost = 0;
  }
}

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
        <span>🛒</span>
        Tap products to add them!
      </div>`;
  } else {
    keys.forEach(k => {
      const item = cart[k];
      const sub  = item.price * item.qty;
      currentTotal += sub;
      html += `
        <div class="order-item current-item">
          <div class="item-info">
            <div class="item-name">${item.name}</div>
            <div class="item-qty">×${item.qty} @ ₱${item.price.toLocaleString()}</div>
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
        <div class="order-item" style="background: rgba(16, 185, 129, 0.1); border-left: 3px solid #10B981; padding: 8px 12px; margin-bottom: 6px; border-radius: 8px;">
          <div class="item-info">
            <div class="item-name">Order #${index + 1}</div>
          </div>
          <div class="item-price">₱${order.total.toLocaleString()}</div>
        </div>`;
    });
  } else {
    ordersHtml = '<div style="opacity: 0.5; font-size: 12px; text-align: center; padding: 20px; color: var(--muted);">No previous orders</div>';
  }
  ordersList.innerHTML = ordersHtml;

  calculateDynamicShipping();

  updateTotals(currentTotal, calculateGrandTotal());
}

function updateTotals(currentTotal, grandTotal) {
  document.getElementById('totalAmount').textContent = grandTotal.toLocaleString();
  document.getElementById('submitBtn').disabled = grandTotal === 0 || !paymentImageData;
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

// ── Submit ALL orders to Google Sheets ──────────────────────
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

  let allItemLines = [];
  orders.forEach(order => allItemLines.push(...order.itemLines));
  Object.values(cart).forEach(item => {
    allItemLines.push(`${item.name} ×${item.qty} = ₱${(item.price * item.qty).toLocaleString()}`);
  });
  
  if (selectedRegion) {
    allItemLines.push(`[Shipping: ${selectedRegion.toUpperCase()} = ₱${selectedShippingCost}]`);
  }

  const grandTotal = calculateGrandTotal();

  const submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = '💗 Sending...';

  const payload = {
    name,
    contact,
    address:   address || '—',
    items:     allItemLines.join(' | '),
    total:     '₱' + grandTotal.toLocaleString(),
    notes:     notes || '—',
    timestamp: new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' }),
    imageName: paymentImageName || '—',
    imageData: paymentImageData || ''
  };

  try {
    await fetch(GOOGLE_SCRIPT_URL, {
      method:  'POST',
      mode:    'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
  } catch (err) {
    console.error('Submission error:', err);
  }

  submitBtn.disabled = false;
  submitBtn.textContent = '💗 Submit My Order 💗';

  document.getElementById('successMsg').textContent =
    `Thank you, ${name}! 🌸 Your order totalling ₱${grandTotal.toLocaleString()} has been received. We'll contact you at ${contact} shortly!`;

  document.getElementById('successOverlay').classList.add('show');
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
  const itemLines = keys.map(k => {
    const item = cart[k];
    return `${item.name} ×${item.qty} = ₱${(item.price * item.qty).toLocaleString()}`;
  });
  orders.push({ total: orderTotal, itemLines });

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

// ── Dynamic Master Database JSON Loader ─────────────────────
async function loadProductsFromJSON() {
  try {
    const response = await fetch("products.json");
    const productData = await response.json();
    
    const catalogContainer = document.getElementById("productCatalog");
    if (!catalogContainer) return;

    let catalogHTML = "";

    productData.forEach(group => {
      // INTERCEPT CONFIG
      if (group.type === "shipping_config" && group.rates) {
        shippingConfig = group.rates;
        return; 
      }

      let pillHTML = group.pill ? `<span class="cat-pill">${group.pill}</span>` : "";
      
      catalogHTML += `
        <div class="product-group" data-group>
          <div class="cat-header">
            <span class="cat-icon">${group.icon}</span>
            <span class="cat-title">${group.category}</span>
            ${pillHTML}
          </div>
          <div class="product-grid">
      `;

      group.items.forEach(item => {
        catalogHTML += `
          <div class="product-card" data-name="${item.fullName}" data-price="${item.price}" onclick="toggleProduct(this)">
            <div class="card-check">✓</div>
            <span class="card-emoji">${item.emoji}</span>
            <div class="card-name">${item.name}</div>
            <div class="card-price">${item.price.toLocaleString()}</div>
            <div class="qty-control">
              <button class="qty-btn" onclick="changeQty(event,this,-1)">−</button>
              <span class="qty-num">1</span>
              <button class="qty-btn" onclick="changeQty(event,this,1)">+</button>
            </div>
          </div>
        `;
      });

      catalogHTML += `
          </div>
        </div>
        <hr class="cat-divider">
      `;
    });

    catalogContainer.innerHTML = catalogHTML;
    
    calculateDynamicShipping();
  } catch (error) {
    console.error("Hala, nag-error ang configuration rendering mapping:", error);
  }
}

// ── Search & Document Base Initialization Listener ──────────
document.addEventListener('DOMContentLoaded', () => {
  loadProductsFromJSON();

  document.getElementById('searchInput').addEventListener('input', function () {
    const q = this.value.toLowerCase();

    document.querySelectorAll('.product-card').forEach(card => {
      card.style.display = card.dataset.name.toLowerCase().includes(q) ? '' : 'none';
    });

    document.querySelectorAll('[data-group]').forEach(group => {
      const hasVisible = [...group.querySelectorAll('.product-card')]
        .some(c => c.style.display !== 'none');
      group.style.display = hasVisible ? '' : 'none';
    });

    document.querySelectorAll('.cat-divider')
      .forEach(d => { d.style.display = q ? 'none' : ''; });
  });
});

// ── Payment tab switcher ────────────────────────────────────
function showPayTab(btn, id) {
  document.querySelectorAll('.pay-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.pay-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('pay-' + id).classList.add('active');
}
