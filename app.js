'use strict';

// ── CONFIG ────────────────────────────────────────────────────────
const DB_ROOT  = 'https://escaneo-b75a3-default-rtdb.firebaseio.com';
const DB       = DB_ROOT + '/productos';
const LOCKS    = DB_ROOT + '/locks';
// ID único por sesión/dispositivo para el sistema de locks
const CLIENT_ID = (localStorage.getItem('ean_client_id') || (() => {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  localStorage.setItem('ean_client_id', id);
  return id;
})());
const LOCK_TTL = 60 * 1000; // 1 min de TTL
let lockInterval = null;

// ── STATE ─────────────────────────────────────────────────────────
const S = {
  raw:     {},      // { sku: { nombre, categoria, ean, imagen1, imagen2, stock } }
  list:    [],      // filtered result [{ sku, ...fields }]
  filter:  'todos',
  query:   '',
  current: null,    // SKU del modal abierto
};

// ── DOM HELPER ────────────────────────────────────────────────────
const g = id => document.getElementById(id);

// ── INIT ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSearch();
  initSwipe();
  initAudio();
  cargarProductos();

  // Liberar lock si el usuario cierra el navegador/tab
  window.addEventListener('pagehide', () => {
    if (S.current) releaseLock(S.current);
  });
  window.addEventListener('beforeunload', () => {
    if (S.current) releaseLock(S.current);
  });
});

// ── DATA ──────────────────────────────────────────────────────────
async function cargarProductos() {
  setView('loading');
  const btn = g('btnRefresh');
  btn.classList.add('spinning');

  try {
    const r = await fetch(`${DB}.json`);
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    if (!data) throw new Error('empty');

    S.raw = data;
    buildCatChips();
    compute();
    setView('list');
    const total = Object.keys(data).length;
    g('headerSub').textContent = `${total} productos`;
  } catch (e) {
    console.error('Error cargando Firebase:', e);
    setView('error');
  } finally {
    btn.classList.remove('spinning');
  }
}

function buildCatChips() {
  const select = g('catSelect');
  if (!select) return;
  select.innerHTML = '<option value="todos" disabled selected hidden>Categorías</option>';

  const cats = [...new Set(
    Object.values(S.raw)
      .map(p => p.categoria || '')
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'es'));

  cats.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
}

// ── COMPUTE (filter + search) ─────────────────────────────────────
function compute() {
  const q = S.query.trim().toLowerCase();

  let list = Object.entries(S.raw).map(([sku, d]) => ({ sku, ...d }));

  // Búsqueda
  if (q) {
    list = list.filter(p =>
      (p.nombre || '').toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.categoria || '').toLowerCase().includes(q)
    );
  }

  // Filtro
  if (S.filter === 'con-ean') {
    list = list.filter(p => hasEAN(p));
  } else if (S.filter === 'sin-ean') {
    list = list.filter(p => !hasEAN(p));
  } else if (S.filter === 'con-stock') {
    list = list.filter(p => Number(p.stock) >= 1);
  } else if (S.filter === 'sin-stock') {
    list = list.filter(p => !p.stock || Number(p.stock) <= 0);
  } else if (S.filter !== 'todos') {
    list = list.filter(p => p.categoria === S.filter);
  }

  // Ordenar: sin EAN primero (necesitan trabajo), luego alfabético
  list.sort((a, b) => {
    const ae = hasEAN(a), be = hasEAN(b);
    if (ae !== be) return ae ? 1 : -1;
    return (a.nombre || a.sku).localeCompare(b.nombre || b.sku, 'es');
  });

  S.list = list;
  renderStats();
  renderList();
}

function hasEAN(p) {
  if (Array.isArray(p.eans) && p.eans.length > 0) return true;
  return typeof p.ean === 'string' && p.ean.length > 0;
}

// ── RENDER STATS ──────────────────────────────────────────────────
function renderStats() {
  const all = S.list;
  const conEAN = all.filter(p => hasEAN(p)).length;
  g('stTotal').textContent  = all.length;
  g('stConEAN').textContent = conEAN;
  g('stSinEAN').textContent = all.length - conEAN;
}

// ── RENDER LISTA ──────────────────────────────────────────────────
function renderList() {
  const list = g('productList');
  const stEmpty = g('stEmpty');

  if (!S.list.length) {
    list.innerHTML = '';
    stEmpty.classList.add('show');
    return;
  }
  stEmpty.classList.remove('show');

  list.innerHTML = S.list.map(cardHTML).join('');

  // Lazy-load imágenes con IntersectionObserver
  const imgs = list.querySelectorAll('img[data-src]');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const img = e.target;
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
        obs.unobserve(img);
      });
    }, { rootMargin: '300px' });
    imgs.forEach(img => io.observe(img));
  } else {
    imgs.forEach(img => { img.src = img.dataset.src; });
  }
}

function cardHTML(p) {
  const nombre = p.nombre || p.sku;
  const tiene  = hasEAN(p);

  const imgEl = p.imagen1
    ? `<img class="card-thumb" data-src="${esc(p.imagen1)}" alt=""
            onerror="imgErr(this)">`
    : `<div class="card-thumb-ph"><i class="bi bi-box-seam"></i></div>`;

  const badge = tiene
    ? `<span class="card-badge badge-g"><i class="bi bi-check-circle-fill"></i> EAN</span>`
    : `<span class="card-badge badge-o"><i class="bi bi-exclamation-circle-fill"></i> Sin EAN</span>`;

  return `
    <div class="card ${tiene ? 'has-ean' : ''}" onclick="openModal('${escAttr(p.sku)}')">
      <div class="card-accent"></div>
      ${imgEl}
      <div class="card-info">
        <div class="card-sku">${esc(p.sku)}</div>
        <div class="card-name">${esc(nombre)}</div>
        ${p.categoria ? `<div class="card-cat"><i class="bi bi-tag"></i>${esc(p.categoria)}</div>` : ''}
        ${badge}
      </div>
      <i class="bi bi-chevron-right card-arrow"></i>
    </div>`;
}

function imgErr(img) {
  img.outerHTML = '<div class="card-thumb-ph"><i class="bi bi-image"></i></div>';
}

function imgShErr(img) {
  img.outerHTML = '<div class="sh-img-ph"><i class="bi bi-image"></i><span>Sin imagen</span></div>';
}

// ── MODAL ─────────────────────────────────────────────────────────
async function openModal(sku) {
  const data = S.raw[sku];
  if (!data) return;
  S.current = sku;

  const p      = { sku, ...data };
  const nombre = p.nombre || sku;
  const ean    = (typeof p.ean === 'string' && p.ean.length > 0) ? p.ean : '';

  // Galería
  const imgs    = [p.imagen1, p.imagen2].filter(Boolean);
  const gallery = imgs.length
    ? imgs.map((u, i) => `
        <img src="${esc(u)}" alt="Imagen ${i + 1}"
             data-url="${esc(u)}" loading="lazy"
             onclick="openLightbox(this.dataset.url)"
             onerror="imgShErr(this)">`
      ).join('')
    : `<div class="sh-img-ph"><i class="bi bi-image"></i><span>Sin imágenes</span></div>`;

  // Sección común (header + galería + info)
  const commonHTML = `
    <div class="sh-header">
      <div style="flex:1;min-width:0">
        <div class="sh-title">${esc(nombre)}</div>
        <div class="sh-sku">
          <i class="bi bi-upc"></i> ${esc(sku)}${p.categoria ? ' · ' + esc(p.categoria) : ''}
        </div>
      </div>
      <button class="sh-close" onclick="closeModal()"><i class="bi bi-x-lg"></i></button>
    </div>

    <div class="sh-gallery">${gallery}</div>

    <div class="ios-group">
      <div class="ios-group-title">Información del producto</div>
      <div class="ios-row">
        <div class="ios-icon ic-blue"><i class="bi bi-upc"></i></div>
        <div>
          <div class="ios-lbl">Código SKU</div>
          <div class="ios-val mono" style="font-size:13px;letter-spacing:1px">${esc(sku)}</div>
        </div>
      </div>
      ${p.categoria ? `
      <div class="ios-row">
        <div class="ios-icon ic-purple"><i class="bi bi-tag-fill"></i></div>
        <div><div class="ios-lbl">Categoría</div><div class="ios-val">${esc(p.categoria)}</div></div>
      </div>` : ''}
      ${p.stock != null ? `
      <div class="ios-row">
        <div class="ios-icon ic-teal"><i class="bi bi-boxes"></i></div>
        <div><div class="ios-lbl">Stock</div><div class="ios-val">${Number(p.stock).toLocaleString('es-AR')} unidades</div></div>
      </div>` : ''}
      <div class="ios-row">
        <div class="ios-icon ${ean ? 'ic-green' : 'ic-orange'}">
          <i class="bi bi-${ean ? 'check-circle-fill' : 'exclamation-circle-fill'}"></i>
        </div>
        <div>
          <div class="ios-lbl">EAN13 actual</div>
          <div class="ios-val ${ean ? 'mono' : 'empty'}">${ean || 'Sin EAN registrado'}</div>
        </div>
      </div>
    </div>`;

  // Mostrar modal de inmediato con spinner mientras se verifica el lock
  g('sheetBody').innerHTML = commonHTML + `
    <div class="act-wrap" style="padding-top:4px">
      <div class="lock-checking">
        <div class="spinner-sm"></div>
        <span>Verificando disponibilidad…</span>
      </div>
    </div>`;

  g('backdrop').classList.add('open');
  g('sheet').classList.add('open');

  // Intentar adquirir lock mientras la animación corre (~380ms)
  const lockOk = await acquireLock(sku);

  if (!lockOk) {
    // Otro usuario tiene este producto abierto
    g('sheetBody').innerHTML = commonHTML + `
      <div class="lock-banner">
        <i class="bi bi-lock-fill"></i>
        <div>
          <div class="lock-banner-title">Producto en edición</div>
          <div class="lock-banner-sub">Otro usuario está modificando este producto ahora mismo.</div>
        </div>
      </div>`;
    feedbackErr();
    showToast('Producto en edición por otra persona', 'error');
    return;
  }

  // Lock adquirido → mostrar sección de scanner y botones
  if (Array.isArray(p.eans) && p.eans.length > 0) {
    S.currentEans = p.eans.map(x => ({ ean: String(x.ean || ''), detalle: String(x.detalle || '') }));
  } else if (typeof p.ean === 'string' && p.ean.length > 0) {
    S.currentEans = [{ ean: p.ean, detalle: '' }];
  } else {
    S.currentEans = [{ ean: '', detalle: '' }];
  }
  const hasSavedEans = Array.isArray(p.eans) && p.eans.length > 0 || (typeof p.ean === 'string' && p.ean.length > 0);

  g('sheetBody').innerHTML = commonHTML + `
    <div class="scan-wrap">
      <div class="scan-card">
        <div class="scan-lbl"><i class="bi bi-upc-scan"></i> Códigos EAN asociados</div>
        <div id="eanListContainer"></div>
        <button class="btn-add-ean" id="btnAddEan" onclick="addEANRow()">
          <i class="bi bi-plus-lg"></i> Agregar otro EAN
        </button>
      </div>
    </div>
    <div class="act-wrap">
      <button class="act-btn btn-save" id="btnSave" onclick="saveEAN()">
        <i class="bi bi-cloud-arrow-up-fill"></i> Guardar
      </button>
      ${hasSavedEans ? `
      <button class="act-btn btn-del" onclick="confirmDeleteEAN()">
        <i class="bi bi-trash3-fill"></i> Eliminar todo
      </button>` : ''}
    </div>`;

  renderEANList(0); // Focus primer elemento siempre
}

async function closeModal() {
  const sku = S.current;
  g('backdrop').classList.remove('open');
  g('sheet').classList.remove('open');
  S.current = null;
  if (sku) await releaseLock(sku);
}

// ── EAN INPUT (MULTIPLE) ──────────────────────────────────────────
function renderEANList(focusIdx = -1) {
  const container = g('eanListContainer');
  if (!container) return;
  
  container.innerHTML = S.currentEans.map((e, i) => `
    <div class="ean-row">
      <div class="ean-field ${e.ean.length > 0 ? 'valid' : ''}">
        <span class="ean-field-icon"><i class="bi bi-upc-scan"></i></span>
        <input class="ean-input" data-idx="${i}" type="tel" inputmode="numeric" pattern="[0-9]*" 
               placeholder="Escaneá o ingresá EAN…" maxlength="15" autocomplete="off" value="${esc(e.ean)}">
        <span class="ean-count ${e.ean.length > 0 ? 'valid' : ''}">${e.ean.length}/15</span>
      </div>
      ${i === 0 ? '' : `
      <div class="ean-detail-wrap">
        <input class="ean-detail-input" data-idx="${i}" type="text" placeholder="Detalle (ej. Unidad, Caja x6)…" maxlength="40" value="${esc(e.detalle)}">
        <button class="btn-del-row" onclick="removeEANRow(${i})"><i class="bi bi-trash-fill"></i></button>
      </div>`}
    </div>
  `).join('');

  g('btnAddEan').style.display = S.currentEans.length < 10 ? 'flex' : 'none';

  const inputs = container.querySelectorAll('.ean-input');
  const details = container.querySelectorAll('.ean-detail-input');

  inputs.forEach(inp => {
    inp.addEventListener('input', () => {
      let val = inp.value.replace(/\D/g, '').slice(0, 15);
      inp.value = val;
      const idx = parseInt(inp.dataset.idx, 10);
      S.currentEans[idx].ean = val;
      
      const row = inp.closest('.ean-field');
      const count = row.querySelector('.ean-count');
      count.textContent = `${val.length}/15`;
      
      if (val.length > 0) {
        row.classList.add('valid');
        count.classList.add('valid');
      } else {
        row.classList.remove('valid');
        count.classList.remove('valid');
      }
      checkSaveBtn();
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const idx = parseInt(inp.dataset.idx, 10);
        if (idx === 0) {
          if (!g('btnSave').disabled) saveEAN();
        } else {
          const detailInp = container.querySelector(`.ean-detail-input[data-idx="${idx}"]`);
          if (detailInp) detailInp.focus();
        }
      }
    });
  });

  details.forEach(inp => {
    inp.addEventListener('input', () => {
      const idx = parseInt(inp.dataset.idx, 10);
      S.currentEans[idx].detalle = inp.value;
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!g('btnSave').disabled) saveEAN();
      }
    });
  });

  checkSaveBtn();

  if (focusIdx >= 0) {
    const inp = container.querySelector(`.ean-input[data-idx="${focusIdx}"]`);
    if (inp) setTimeout(() => inp.focus(), 150);
  }
}

function checkSaveBtn() {
  const btn = g('btnSave');
  if (!btn) return;
  const allValid = S.currentEans.every(e => e.ean.length > 0);
  btn.disabled = S.currentEans.length === 0 || !allValid;
}

window.addEANRow = function() {
  if (S.currentEans.length < 10) {
    S.currentEans.push({ ean: '', detalle: '' });
    renderEANList(S.currentEans.length - 1);
  }
};

window.removeEANRow = function(idx) {
  if (S.currentEans.length > 1) {
    S.currentEans.splice(idx, 1);
    renderEANList();
  }
};

// ── FIREBASE OPS ──────────────────────────────────────────────────
async function saveEAN() {
  const eansToSave = S.currentEans.map(e => ({
    ean: e.ean.trim(),
    detalle: e.detalle.trim()
  })).filter(e => e.ean.length > 0);

  if (eansToSave.length === 0) {
    showToast('Debés ingresar al menos 1 dígito en los campos EAN', 'error');
    return;
  }

  const sku = S.current;
  if (!sku) return;

  const btn = g('btnSave');
  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Guardando…';

  try {
    const primaryEan = eansToSave[0].ean;
    const r = await fetch(`${DB}/${encodeURIComponent(sku)}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ean: primaryEan, eans: eansToSave }),
    });
    if (!r.ok) throw new Error(r.status);

    S.raw[sku].ean = primaryEan;
    S.raw[sku].eans = eansToSave;
    compute();
    feedbackOk();
    showToast('Guardado correctamente', 'success');
    setTimeout(closeModal, 900);
  } catch (e) {
    console.error('Error guardando EAN:', e);
    feedbackErr();
    showToast('Error al guardar. Verificá la conexión.', 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-cloud-arrow-up-fill"></i> Guardar';
  }
}

function confirmDeleteEAN() {
  const sku = S.current;
  if (!sku) return;
  const nombre = S.raw[sku]?.nombre || sku;
  
  Swal.fire({
    title: '¿Eliminar todo?',
    text: `¿Eliminar todos los EANs del producto "${nombre}"?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    cancelButtonColor: '#0a84ff',
    confirmButtonText: 'Sí, eliminar',
    cancelButtonText: 'Cancelar'
  }).then((result) => {
    if (result.isConfirmed) {
      deleteEAN();
    }
  });
}

async function deleteEAN() {
  const sku = S.current;
  if (!sku) return;

  try {
    const r = await fetch(`${DB}/${encodeURIComponent(sku)}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ean: null, eans: null }),
    });
    if (!r.ok) throw new Error(r.status);

    delete S.raw[sku].ean;
    delete S.raw[sku].eans;
    compute();
    feedbackOk();
    showToast('EANs eliminados correctamente', 'success');
    setTimeout(closeModal, 700);
  } catch (e) {
    console.error('Error eliminando EAN:', e);
    feedbackErr();
    showToast('Error al eliminar', 'error');
  }
}

// ── SEARCH / FILTER ───────────────────────────────────────────────
function initSearch() {
  let t;
  const inp   = g('searchInput');
  const clear = g('btnClear');

  inp.addEventListener('input', () => {
    S.query = inp.value;
    clear.classList.toggle('show', !!inp.value);
    clearTimeout(t);
    t = setTimeout(compute, 240);
  });
}

function clearSearch() {
  const inp = g('searchInput');
  inp.value = '';
  S.query = '';
  g('btnClear').classList.remove('show');
  compute();
  inp.focus();
}

function setFilter(filter, btn) {
  S.filter = filter;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  const selectWrap = g('catSelectWrap');
  const catLabel = g('catLabel');
  const select = g('catSelect');

  if (selectWrap) selectWrap.classList.remove('active');

  if (btn) {
    btn.classList.add('active');
    if (select) select.value = 'todos';
    if (catLabel) catLabel.textContent = 'Categorías';
  } else if (filter !== 'todos' && filter !== 'con-ean' && filter !== 'sin-ean' && filter !== 'con-stock' && filter !== 'sin-stock') {
    if (selectWrap) selectWrap.classList.add('active');
    if (catLabel && select) {
      const opt = select.options[select.selectedIndex];
      catLabel.textContent = opt ? opt.text : filter;
    }
  }

  compute();
}

// ── VIEW STATES ───────────────────────────────────────────────────
function setView(mode) {
  g('stLoading').classList.toggle('show', mode === 'loading');
  g('stError').classList.toggle('show',   mode === 'error');
  const list = g('productList');
  if (mode === 'loading' || mode === 'error') {
    list.innerHTML = '';
  }
}

// ── TOAST ─────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'success') {
  const t    = g('toast');
  const icon = type === 'success'
    ? '<i class="bi bi-check-circle-fill toast-icon"></i>'
    : '<i class="bi bi-x-circle-fill"></i>';
  t.innerHTML = `${icon} ${msg}`;
  t.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ── LIGHTBOX ──────────────────────────────────────────────────────
function openLightbox(url) {
  g('lightboxImg').src = url;
  g('lightbox').classList.add('show');
}
function closeLightbox() {
  g('lightbox').classList.remove('show');
}

// ── LOCK (concurrencia) ───────────────────────────────────────────
// Usa ETag de Firebase para escritura condicional atómica.
// Si dos usuarios intentan lockear al mismo tiempo, solo uno gana (412).
async function acquireLock(sku) {
  const url = `${LOCKS}/${encodeURIComponent(sku)}.json`;
  try {
    const getRes = await fetch(url, { headers: { 'X-Firebase-ETag': 'true' } });
    const etag   = getRes.headers.get('ETag');
    const lock   = await getRes.json();
    const now    = Date.now();

    // ¿Otro usuario tiene un lock vigente?
    if (lock && lock.exp > now && lock.cid !== CLIENT_ID) {
      return false;
    }

    // Escritura condicional: solo procede si el nodo no cambió desde el GET
    const headers = { 'Content-Type': 'application/json' };
    if (etag) headers['if-match'] = etag;

    const putRes = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ cid: CLIENT_ID, ts: now, exp: now + LOCK_TTL }),
    });

    if (putRes.ok) {
      clearInterval(lockInterval);
      lockInterval = setInterval(() => refreshLock(sku), LOCK_TTL / 2);
    }

    // 412 = race condition, alguien más lo tomó en el mismo instante
    return putRes.ok;
  } catch {
    return true; // fallo de red → fail open (no bloquear al usuario)
  }
}

async function refreshLock(sku) {
  if (S.current !== sku) {
    clearInterval(lockInterval);
    return;
  }
  const url = `${LOCKS}/${encodeURIComponent(sku)}.json`;
  try {
    const getRes = await fetch(url, { headers: { 'X-Firebase-ETag': 'true' } });
    const etag   = getRes.headers.get('ETag');
    const lock   = await getRes.json();
    const now    = Date.now();

    if (lock && lock.cid === CLIENT_ID) {
      const headers = { 'Content-Type': 'application/json' };
      if (etag) headers['if-match'] = etag;

      await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ cid: CLIENT_ID, ts: lock.ts, exp: now + LOCK_TTL }),
      });
    } else {
      clearInterval(lockInterval);
    }
  } catch { /* ignorar errores en background */ }
}

async function releaseLock(sku) {
  if (!sku) return;
  clearInterval(lockInterval);
  const url = `${LOCKS}/${encodeURIComponent(sku)}.json`;
  try {
    // Usamos keepalive para que sobreviva si se cierra la pestaña
    const getRes = await fetch(url, { cache: 'no-store' });
    const lock   = await getRes.json();
    if (lock && lock.cid === CLIENT_ID) {
      await fetch(url, { method: 'DELETE', keepalive: true });
    }
  } catch { /* ignorar errores al soltar */ }
}

// ── AUDIO ─────────────────────────────────────────────────────────
let _audioCtx = null;

function initAudio() {
  // Pre-crear AudioContext en el primer toque del usuario
  const resume = () => {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } else if (_audioCtx.state === 'suspended') {
      _audioCtx.resume();
    }
  };
  document.addEventListener('touchstart', resume, { passive: true });
  document.addEventListener('mousedown',  resume, { passive: true });
}

function playBeep(type) {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    const ctx = _audioCtx;
    const now = ctx.currentTime;

    if (type === 'ok') {
      // Beep corto y agudo estilo pistola de código de barras
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1800, now);
      osc.frequency.exponentialRampToValueAtTime(1400, now + 0.07);
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.1);
    } else {
      // Doble beep descendente de error
      [0, 0.18].forEach(delay => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(520, now + delay);
        osc.frequency.exponentialRampToValueAtTime(320, now + delay + 0.12);
        gain.gain.setValueAtTime(0.18, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.13);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + delay); osc.stop(now + delay + 0.14);
      });
    }
  } catch { /* AudioContext no disponible */ }
}

function feedbackOk() {
  playBeep('ok');
  navigator.vibrate?.(40);
}

function feedbackErr() {
  playBeep('err');
  navigator.vibrate?.([60, 40, 80]);
}

// ── SWIPE DOWN PARA CERRAR ────────────────────────────────────────
function initSwipe() {
  const sheet = g('sheet');
  let y0 = 0, dragging = false;

  sheet.addEventListener('touchstart', e => {
    if (sheet.scrollTop > 0) return;
    y0 = e.touches[0].clientY;
    dragging = true;
    sheet.style.transition = 'none';
  }, { passive: true });

  sheet.addEventListener('touchmove', e => {
    if (!dragging) return;
    const dy = e.touches[0].clientY - y0;
    if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });

  sheet.addEventListener('touchend', e => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    sheet.style.transform  = '';
    const dy = e.changedTouches[0].clientY - y0;
    if (dy > 90) closeModal();
  }, { passive: true });
}

// ── UTILS ─────────────────────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Para atributos HTML: comillas simples ya escapadas → usamos esc()
function escAttr(s) {
  return esc(s);
}
