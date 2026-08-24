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
  login: (credentials) => api.post('/auth/login', credentials),

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

  /* --- Orders --- */
  getOrders:        (params = '') => api.get(`/orders${params}`),
  getOrder:         (id)          => api.get(`/orders/${id}`),
  createOrder:      (data)        => api.post('/orders', data),
  updateOrderStatus:(id, status)  => api.patch(`/orders/${id}/status`, { status }),
  updatePayment:    (id, data)    => api.patch(`/orders/${id}/payment`, data),

  /* --- Live --- */
  getActiveLive:    ()            => api.get('/live/active'),
  getCurrentProduct:()            => api.get('/live/current-product'),
  createLiveSession:(data)        => api.post('/live', data),
  endLiveSession:   (id)          => api.patch(`/live/${id}/end`, {}),
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
    const map = {
      active:     'badge-success', inactive:  'badge-gray',  out_of_stock: 'badge-warning',
      pending:    'badge-warning', confirmed: 'badge-info',  processing: 'badge-primary',
      shipped:    'badge-info',    delivered: 'badge-success', cancelled: 'badge-danger',
      paid:       'badge-success', unpaid:    'badge-danger', partial:   'badge-warning',
      ended:      'badge-gray',    paused:    'badge-warning',
    };
    return `<span class="badge ${map[status] || 'badge-gray'}">${status}</span>`;
  },
  imgUrl: (path) => path ? `${window.location.origin}${path}` : null,
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
