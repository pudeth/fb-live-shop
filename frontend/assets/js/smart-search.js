/**
 * smart-search.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared product-search engine used by both cashier pages.
 *
 * Features
 *  • Fuzzy substring scoring  (consecutive chars score higher)
 *  • Searches name, product_code, category name
 *  • Match highlight — wraps matched chars in <mark>
 *  • Category chip strip (All + one chip per category)
 *  • Stock status badge  (green ≥10 | yellow 1-9 | red out)
 *  • Result count badge in toolbar
 *  • Keyboard navigation  ↑ ↓ Enter across product tiles
 *  • Debounced input  (120 ms)
 *  • Clear button appears when query is non-empty
 *
 * Usage
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  SmartSearch.init({                                                  │
 *  │    searchId:    'product-search',   // <input> id                   │
 *  │    gridId:      'product-grid',     // container to render into     │
 *  │    clearBtnId:  'search-clear-btn', // optional clear button id     │
 *  │    countBadgeId:'search-count',     // optional result-count span   │
 *  │    chipStripId: 'cat-chips',        // optional chip strip div      │
 *  │    getData:     () => allProducts,  // fn returning current array   │
 *  │    renderTile:  (p, query) => html, // fn returning tile HTML       │
 *  │    onKeySelect: (p) => {},          // called on Enter / keyboard   │
 *  │  });                                                                 │
 *  │                                                                      │
 *  │  // Call whenever data or currency changes:                          │
 *  │  SmartSearch.refresh('product-search');                              │
 *  └─────────────────────────────────────────────────────────────────────┘
 */
const SmartSearch = (() => {
  const _instances = {};   // keyed by searchId

  /* ─── Fuzzy scoring ─────────────────────────────────────────────────── */
  /**
   * Returns a score ≥ 0.  Higher = better match.  0 = no match.
   * Consecutive matched chars get bonus.  Prefix match gets big bonus.
   */
  function fuzzyScore(text, query) {
    if (!query) return 1;
    text  = text.toLowerCase();
    query = query.toLowerCase();
    if (text.includes(query)) return 100 + (text.startsWith(query) ? 50 : 0) + (1 / (text.length || 1));
    let ti = 0, qi = 0, score = 0, consecutive = 0;
    while (ti < text.length && qi < query.length) {
      if (text[ti] === query[qi]) {
        consecutive++;
        score += 1 + consecutive * 0.5;
        qi++;
      } else {
        consecutive = 0;
      }
      ti++;
    }
    return qi === query.length ? score : 0;
  }

  /* ─── Highlight ─────────────────────────────────────────────────────── */
  function highlight(text, query) {
    if (!query) return escHtml(text);
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escHtml(text);
    return (
      escHtml(text.slice(0, idx)) +
      `<mark style="background:#fef08a;color:#713f12;border-radius:2px;padding:0 1px">${escHtml(text.slice(idx, idx + query.length))}</mark>` +
      escHtml(text.slice(idx + query.length))
    );
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ─── Stock badge ───────────────────────────────────────────────────── */
  function stockBadge(stock) {
    if (stock === 0)  return `<span style="display:inline-block;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;background:#fee2e2;color:#991b1b">Out</span>`;
    if (stock <= 9)   return `<span style="display:inline-block;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;background:#fef3c7;color:#92400e">${stock} left</span>`;
    return `<span style="display:inline-block;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;background:#dcfce7;color:#166534">${stock}</span>`;
  }

  /* ─── Category chips ─────────────────────────────────────────────────── */
  function buildChips(inst) {
    const strip = document.getElementById(inst.chipStripId);
    if (!strip) return;
    const products = inst.getData();
    const cats = {};
    products.forEach(p => {
      if (p.category_id && p.category_name) cats[p.category_id] = p.category_name;
    });
    strip.innerHTML = `
      <button class="ss-chip ${!inst.activeCat ? 'active' : ''}" onclick="SmartSearch._setChip('${inst.searchId}', '')">All</button>
      ${Object.entries(cats).map(([id, name]) =>
        `<button class="ss-chip ${inst.activeCat === id ? 'active' : ''}" onclick="SmartSearch._setChip('${inst.searchId}','${id}')">${escHtml(name)}</button>`
      ).join('')}`;
  }

  /* ─── Core render ────────────────────────────────────────────────────── */
  function render(inst) {
    const input   = document.getElementById(inst.searchId);
    const grid    = document.getElementById(inst.gridId);
    const clearBtn = inst.clearBtnId  ? document.getElementById(inst.clearBtnId)  : null;
    const badge   = inst.countBadgeId ? document.getElementById(inst.countBadgeId) : null;
    if (!input || !grid) return;

    const query   = (input.value || '').trim();
    const catId   = inst.activeCat || '';
    const products = inst.getData();

    // Filter + score
    let results = products
      .map(p => {
        if (catId && String(p.category_id) !== catId) return null;
        const nameScore = fuzzyScore(p.name, query);
        const codeScore = fuzzyScore(p.product_code, query) * 1.2; // code match scores higher
        const catScore  = p.category_name ? fuzzyScore(p.category_name, query) * 0.5 : 0;
        const score     = Math.max(nameScore, codeScore, catScore);
        return score > 0 ? { p, score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    // Clear btn visibility
    if (clearBtn) clearBtn.style.display = query ? 'flex' : 'none';

    // Count badge
    if (badge) {
      badge.textContent = results.length
        ? `${results.length} product${results.length !== 1 ? 's' : ''}`
        : '';
      badge.style.color = results.length ? 'var(--gray-400)' : 'var(--danger)';
    }

    // Empty state
    if (!results.length) {
      grid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--gray-400)">
          <div style="font-size:36px;margin-bottom:10px">🔍</div>
          <div style="font-size:14px;font-weight:700;color:var(--gray-500);margin-bottom:4px">No products found</div>
          <div style="font-size:12px">Try a different name, code, or category</div>
          ${query ? `<button onclick="SmartSearch._clearSearch('${inst.searchId}')"
            style="margin-top:12px;padding:6px 16px;border-radius:20px;border:1.5px solid var(--primary);
                   color:var(--primary);background:#fff;font-size:12px;font-weight:600;cursor:pointer">
            Clear search</button>` : ''}
        </div>`;
      inst.focusIdx = -1;
      return;
    }

    // Render tiles
    grid.innerHTML = results.map(({ p }, i) =>
      inst.renderTile(p, query, i)
    ).join('');

    // Keyboard focus ring
    _applyFocusRing(inst);

    // Rebuild chips on first load (data might have arrived)
    buildChips(inst);
  }

  /* ─── Keyboard navigation ────────────────────────────────────────────── */
  function _applyFocusRing(inst) {
    const grid  = document.getElementById(inst.gridId);
    if (!grid) return;
    const tiles = grid.querySelectorAll('[data-ss-idx]');
    tiles.forEach(t => {
      t.classList.toggle('ss-focused', Number(t.dataset.ssIdx) === inst.focusIdx);
    });
  }

  function _handleKey(searchId, e) {
    const inst  = _instances[searchId];
    if (!inst) return;
    const grid  = document.getElementById(inst.gridId);
    if (!grid) return;
    const tiles = Array.from(grid.querySelectorAll('[data-ss-idx]'));
    if (!tiles.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      inst.focusIdx = Math.min(inst.focusIdx + 1, tiles.length - 1);
      _applyFocusRing(inst);
      tiles[inst.focusIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      inst.focusIdx = Math.max(inst.focusIdx - 1, 0);
      _applyFocusRing(inst);
      tiles[inst.focusIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (inst.focusIdx >= 0 && tiles[inst.focusIdx]) {
        tiles[inst.focusIdx].click();
      } else if (tiles.length === 1) {
        // Only one result — auto-select it
        tiles[0].click();
      }
    } else if (e.key === 'Escape') {
      inst.focusIdx = -1;
      _applyFocusRing(inst);
      document.getElementById(searchId)?.blur();
    }
  }

  /* ─── Public API ─────────────────────────────────────────────────────── */
  function init(opts) {
    const {
      searchId, gridId, clearBtnId, countBadgeId, chipStripId,
      getData, renderTile, onKeySelect,
    } = opts;

    const inst = {
      searchId, gridId, clearBtnId, countBadgeId, chipStripId,
      getData, renderTile, onKeySelect,
      activeCat: '',
      focusIdx:  -1,
      _debTimer: null,
    };
    _instances[searchId] = inst;

    const input = document.getElementById(searchId);
    if (!input) return;

    input.addEventListener('input', () => {
      inst.focusIdx = -1;
      clearTimeout(inst._debTimer);
      inst._debTimer = setTimeout(() => render(inst), 120);
    });

    input.addEventListener('keydown', e => _handleKey(searchId, e));

    // Clear btn
    if (clearBtnId) {
      const cb = document.getElementById(clearBtnId);
      if (cb) cb.addEventListener('click', () => _clearSearch(searchId));
    }

    render(inst);
  }

  function refresh(searchId) {
    const inst = _instances[searchId];
    if (inst) render(inst);
  }

  function _setChip(searchId, catId) {
    const inst = _instances[searchId];
    if (!inst) return;
    inst.activeCat = catId;
    inst.focusIdx  = -1;
    render(inst);
  }

  function _clearSearch(searchId) {
    const input = document.getElementById(searchId);
    if (input) { input.value = ''; input.focus(); }
    const inst = _instances[searchId];
    if (inst) { inst.focusIdx = -1; render(inst); }
  }

  return { init, refresh, _setChip, _clearSearch, highlight, stockBadge, escHtml };
})();
