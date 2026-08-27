/* ===== API CLIENT ===== */
const API_BASE = window.location.origin + '/api';

const api = {
  _token() {
    return localStorage.getItem('token');
  },

  async _request(method, path, body, isFormData = false) {
    const headers = {};
    if (!isFormData) headers['Content-Type'] = 'application/json';
    const token = this._token();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const opts = { method, headers };
    if (body) opts.body = isFormData ? body : JSON.stringify(body);

    const res = await fetch(API_BASE + path, opts);
    const data = await res.json();

    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login.html';
      return;
    }

    return data;
  },

  get:    (path)           => api._request('GET',    path),
  post:   (path, body)     => api._request('POST',   path, body),
  put:    (path, body)     => api._request('PUT',    path, body),
  patch:  (path, body)     => api._request('PATCH',  path, body),
  delete: (path)           => api._request('DELETE', path),
  upload: (path, formData) => api._request('POST',   path, formData, true),

  /* --- Auth --- */
  login:    (credentials) => api.post('/auth/login', credentials),
  getUsers: ()            => api.get('/auth/users'),
  register: (data)        => api.post('/auth/register', data),

  /* --- Categories --- */
  getCategories:    (params = '') => api.get(`/categories${params}`),
  createCategory:   (data)        => api.post('/categories', data),
  updateCategory:   (id, data)    => api.put(`/categories/${id}`, data),
  deleteCategory:   (id)          => api.delete(`/categories/${id}`),

  /* --- Products --- */
  getProducts:      (params = '') => api.get(`/products${params}`),
  getProduct:       (id)          => api.get(`/products/${id}`),
  createProduct:    (data)        => api.post('/products', data),
  updateProduct:    (id, data)    => api.put(`/products/${id}`, data),
  deleteProduct:    (id)          => api.delete(`/products/${id}`),
  uploadImage:      (formData)    => api.upload('/products/upload-image', formData),
  uploadImages:     (formData)    => api.upload('/products/upload-images', formData),

  /* --- Orders --- */
  getOrders:        (params = '') => api.get(`/orders${params}`),
  getOrder:         (id)          => api.get(`/orders/${id}`),
  createOrder:      (data)        => api.post('/orders', data),
  updateOrderStatus:(id, status)  => api.patch(`/orders/${id}/status`, { status }),
  updatePayment:    (id, data)    => api.patch(`/orders/${id}/payment`, data),

  /* --- Translation Bot --- */
  translate:        (text, to = 'km', from = 'en') => api.post('/translate', { text, to, from }),
  translateMultiple:(texts, to = 'km', from = 'en')=> api.post('/translate', { texts, to, from }),
  translateProduct: (name, description)            => api.post('/translate/product', { name, description }),

  /* --- Live --- */
  getActiveLive:    ()            => api.get('/live/active'),
  getCurrentProduct:()            => api.get('/live/current-product'),
  createLiveSession:(data)        => api.post('/live', data),
  endLiveSession:   (id)          => api.patch(`/live/${id}/end`, {}),
};

/* ===== MULTI-LANGUAGE TRANSLATOR BOT (EN / KM / ZH) ===== */
const I18N = {
  getLang() {
    return localStorage.getItem('app_lang') || 'en';
  },
  setLang(lang) {
    localStorage.setItem('app_lang', lang);
  },
  dict: {
    en: {
      liveNow: 'LIVE NOW',
      inStock: 'In Stock',
      lowStock: 'Low Stock',
      outOfStock: 'Out of Stock',
      chooseOptions: 'Choose Options',
      aboutProduct: 'About This Product',
      productDescription: 'Product Description',
      totalPrice: 'Total Price',
      orderNow: 'Order Now',
      save: 'Save',
      saved: 'Saved',
      copyLink: 'Copy Link',
      share: 'Share',
      scanQr: 'Scan QR',
      fastDelivery: 'Fast Delivery',
      cod: 'Cash on Delivery',
      genuineQuality: '100% Quality',
      placedOrder: 'Order Placed!',
      fillDetails: 'Customer Information',
      fullName: 'Full Name',
      phoneNumber: 'Phone Number',
      deliveryAddress: 'Delivery Address',
      notes: 'Notes / Remarks (optional)',
      paymentMethod: 'Payment Method',
      confirmOrder: 'Confirm Order',
      orderSummary: 'Order Summary',
      quantity: 'Quantity',
    },
    km: {
      liveNow: 'កំពុងផ្សាយផ្ទាល់',
      inStock: 'មានក្នុងស្តុក',
      lowStock: 'នៅសល់តិច',
      outOfStock: 'អស់ពីស្តុក',
      chooseOptions: 'ជ្រើសរើសជម្រើស',
      aboutProduct: 'ព័ត៌មានលម្អិតអំពីទំនិញ',
      productDescription: 'ការពិពណ៌នាអំពីទំនិញ',
      totalPrice: 'តម្លៃសរុប',
      orderNow: 'បញ្ជាទិញឥឡូវនេះ',
      save: 'រក្សាទុក',
      saved: 'បានរក្សាទុក',
      copyLink: 'ចម្លងតំណភ្ជាប់',
      share: 'ចែករំលែក',
      scanQr: 'ស្កេន QR',
      fastDelivery: 'ដឹកជញ្ជូនរហ័ស',
      cod: 'ទូទាត់ពេលទទួល (COD)',
      genuineQuality: 'គុណភាពពិត ១០០%',
      placedOrder: 'ការបញ្ជាទិញបានជោគជ័យ!',
      fillDetails: 'ព័ត៌មានអតិថិជន',
      fullName: 'ឈ្មោះពេញ',
      phoneNumber: 'លេខទូរស័ព្ទ',
      deliveryAddress: 'អាសយដ្ឋានដឹកជញ្ជូន',
      notes: 'ចំណាំបន្ថែម (ស្រេចចិត្ត)',
      paymentMethod: 'វិធីសាស្ត្រទូទាត់ប្រាក់',
      confirmOrder: 'បញ្ជាក់ការបញ្ជាទិញ',
      orderSummary: 'សេចក្តីសង្ខេបការបញ្ជាទិញ',
      quantity: 'ចំនួន',
    },
    zh: {
      liveNow: '正在直播',
      inStock: '有现货',
      lowStock: '库存紧张',
      outOfStock: '暂时缺货',
      chooseOptions: '选择规格',
      aboutProduct: '商品详情',
      productDescription: '商品描述',
      totalPrice: '总价',
      orderNow: '立即下单',
      save: '收藏',
      saved: '已收藏',
      copyLink: '复制链接',
      share: '分享',
      scanQr: '扫码查看',
      fastDelivery: '急速发货',
      cod: '货到付款 (COD)',
      genuineQuality: '100% 正品保障',
      placedOrder: '下单成功！',
      fillDetails: '收货人信息',
      fullName: '收货人姓名',
      phoneNumber: '联系电话',
      deliveryAddress: '收货详细地址',
      notes: '订单备注 (选填)',
      paymentMethod: '支付方式',
      confirmOrder: '确认提交订单',
      orderSummary: '订单明细',
      quantity: '数量',
    }
  },
  t(key) {
    const lang = this.getLang();
    return this.dict[lang]?.[key] || this.dict.en?.[key] || key;
  }
};

/* ===== AUTH HELPERS ===== */
const auth = {
  getUser() {
    try { return JSON.parse(localStorage.getItem('user')); }
    catch { return null; }
  },
  setSession(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },
  isLoggedIn() { return !!localStorage.getItem('token'); },
  requireAuth(allowedRoles = []) {
    if (!this.isLoggedIn()) {
      window.location.href = '/login.html';
      return false;
    }
    const user = this.getUser();
    if (allowedRoles.length && !allowedRoles.includes(user?.role)) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  }
};

/* ===== TOAST ===== */
function showToast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = '.2s ease';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

/* ===== MODAL HELPERS ===== */
function openModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.add('open'); document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.remove('open'); document.body.style.overflow = ''; }
}
// Close on backdrop click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-backdrop')) {
    e.target.classList.remove('open');
    document.body.style.overflow = '';
  }
});

/* ===== FORMAT HELPERS ===== */
const KHR_RATE = 4100; // 1 USD = 4,100 KHR

/* Currency mode: 'USD' (default) or 'KHR' — persisted in localStorage */
const currencyMode = {
  get()       { return localStorage.getItem('currencyMode') || 'USD'; },
  set(mode)   { localStorage.setItem('currencyMode', mode); },
  isKHR()     { return this.get() === 'KHR'; },
  toggle()    { this.set(this.isKHR() ? 'USD' : 'KHR'); },
};

const fmt = {
  currency(v) {
    const n = Number(v || 0);
    if (currencyMode.isKHR()) {
      return '៛' + Math.round(n * KHR_RATE).toLocaleString('en-US');
    }
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },
  currencyKHR:  (v) => '៛' + Math.round(Number(v || 0) * KHR_RATE).toLocaleString('en-US'),
  currencyDual: (v) => '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' / ៛' + Math.round(Number(v || 0) * KHR_RATE).toLocaleString('en-US'),
  date:     (v) => new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
  datetime: (v) => new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  statusBadge(status) {
    const s = (status || '').toLowerCase();
    const map = {
      active:     'badge-success', inactive:  'badge-gray',  out_of_stock: 'badge-warning',
      pending:    'badge-warning', confirmed: 'badge-info',  processing: 'badge-primary',
      shipping:   'badge-info',    shipped:    'badge-info',
      completed:  'badge-success', delivered: 'badge-success', cancelled: 'badge-danger',
      paid:       'badge-success', unpaid:    'badge-danger', partial:   'badge-warning',
      ended:      'badge-gray',    paused:    'badge-warning',
    };
    return `<span class="badge ${map[s] || 'badge-gray'}">${status}</span>`;
  },
  imgUrl: (path) => {
    if (!path) return null;
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) return path;
    return `${window.location.origin}${path.startsWith('/') ? path : '/' + path}`;
  },
};

/* ===== CURRENCY TOGGLE ===== */
/**
 * Injects a USD/KHR pill toggle into any element matching `containerSelector`
 * (defaults to `.topbar-actions` for admin, pass `.c-topbar` for cashier).
 * `onToggle` — callback fired after mode changes (usually your page's load/render fn).
 *
 * Usage:  initCurrencyToggle(() => loadProducts());
 *         initCurrencyToggle(() => renderCart(), '.c-topbar');
 */
function initCurrencyToggle(onToggle, containerSelector = '.topbar-actions') {
  const container = document.querySelector(containerSelector);
  if (!container) return;

  const btn = document.createElement('button');
  btn.id = 'currency-toggle-btn';
  btn.title = 'Switch currency';
  btn.style.cssText = [
    'display:inline-flex', 'align-items:center', 'gap:5px',
    'padding:5px 12px', 'border-radius:20px', 'border:2px solid var(--primary)',
    'background:transparent', 'cursor:pointer', 'font-size:12px',
    'font-weight:800', 'color:var(--primary)', 'transition:all .18s',
    'white-space:nowrap', 'flex-shrink:0',
  ].join(';');

  function updateBtn() {
    const isKHR = currencyMode.isKHR();
    btn.setAttribute('data-mode', isKHR ? 'KHR' : 'USD');
    btn.innerHTML = isKHR
      ? '<span style="opacity:.7">USD</span><span style="font-size:14px">⇄</span><span>KHR ៛</span>'
      : '<span>USD $</span><span style="font-size:14px">⇄</span><span style="opacity:.7">KHR</span>';
    btn.style.background  = isKHR ? 'var(--primary)' : 'transparent';
    btn.style.color       = isKHR ? '#fff'           : 'var(--primary)';
    btn.style.borderColor = 'var(--primary)';
  }

  btn.addEventListener('click', () => {
    currencyMode.toggle();
    updateBtn();
    if (typeof onToggle === 'function') onToggle();
  });

  updateBtn();

  // Insert before first child so it appears at the left of topbar-actions
  container.insertBefore(btn, container.firstChild);
}
