const RENDER_DEFAULT = 'https://fb-live-shop.onrender.com';
const LOCAL_DEFAULT = 'http://localhost:3000';

const inputEl = document.getElementById('server-url-input');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const pingText = document.getElementById('ping-text');
const statusMsg = document.getElementById('status-msg');
const btnPresetRender = document.getElementById('btn-preset-render');
const btnPresetLocal = document.getElementById('btn-preset-local');
const btnSave = document.getElementById('btn-save');
const btnOpenPos = document.getElementById('btn-open-pos');

function updatePresetButtons(url) {
  const norm = (url || '').trim().replace(/\/+$/, '');
  btnPresetRender.classList.toggle('active', norm === RENDER_DEFAULT);
  btnPresetLocal.classList.toggle('active', norm === LOCAL_DEFAULT);
}

async function testConnection(serverUrl) {
  const cleanUrl = (serverUrl || '').trim().replace(/\/+$/, '');
  if (!cleanUrl) return;

  statusDot.className = 'dot checking';
  statusText.textContent = 'Testing connection...';
  pingText.textContent = '...';

  const start = Date.now();
  try {
    const res = await fetch(`${cleanUrl}/api/comments/status`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    const ping = Date.now() - start;

    if (res.ok) {
      statusDot.className = 'dot';
      statusText.textContent = 'Connected (Online)';
      pingText.textContent = `${ping}ms`;
      statusMsg.style.color = '#4ade80';
      statusMsg.textContent = '✓ Server reachable & ready to track';
    } else {
      statusDot.className = 'dot offline';
      statusText.textContent = `Error ${res.status}`;
      pingText.textContent = `${ping}ms`;
      statusMsg.style.color = '#f87171';
      statusMsg.textContent = `Server responded with HTTP ${res.status}`;
    }
  } catch (err) {
    statusDot.className = 'dot offline';
    statusText.textContent = 'Offline (Cannot Reach)';
    pingText.textContent = 'ERR';
    statusMsg.style.color = '#f87171';
    statusMsg.textContent = 'Failed to connect. Check URL or hosting status.';
  }
}

// Load saved or default URL
chrome.storage.local.get(['pos_server_url'], (res) => {
  const currentUrl = res.pos_server_url || RENDER_DEFAULT;
  inputEl.value = currentUrl;
  updatePresetButtons(currentUrl);
  testConnection(currentUrl);
});

btnPresetRender.addEventListener('click', () => {
  inputEl.value = RENDER_DEFAULT;
  updatePresetButtons(RENDER_DEFAULT);
  saveAndTest();
});

btnPresetLocal.addEventListener('click', () => {
  inputEl.value = LOCAL_DEFAULT;
  updatePresetButtons(LOCAL_DEFAULT);
  saveAndTest();
});

btnSave.addEventListener('click', () => {
  saveAndTest();
});

btnOpenPos.addEventListener('click', () => {
  const url = (inputEl.value.trim() || RENDER_DEFAULT).replace(/\/+$/, '');
  window.open(`${url}/cashier/live.html`, '_blank');
});

function saveAndTest() {
  let url = inputEl.value.trim().replace(/\/+$/, '');
  if (!url) url = RENDER_DEFAULT;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  inputEl.value = url;
  updatePresetButtons(url);

  chrome.storage.local.set({ pos_server_url: url }, () => {
    testConnection(url);
  });
}
