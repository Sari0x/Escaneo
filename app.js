'use strict';

// ── CONFIG ────────────────────────────────────────────────────────
const DB = 'https://escaneo-b75a3-default-rtdb.firebaseio.com/productos';

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
  initBluetooth();
  cargarProductos();
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
  const row = g('chipsRow');
  // Eliminar chips de categorías anteriores
  row.querySelectorAll('[data-cat]').forEach(el => el.remove());

  const cats = [...new Set(
    Object.values(S.raw)
      .map(p => p.categoria || '')
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'es'));

  cats.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.dataset.filter = cat;
    btn.dataset.cat = '1';
    btn.innerHTML = `<i class="bi bi-tag-fill"></i> ${esc(cat)}`;
    btn.onclick = () => setFilter(cat, btn);
    row.appendChild(btn);
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
  return typeof p.ean === 'string' && p.ean.length === 13;
}

// ── RENDER STATS ──────────────────────────────────────────────────
function renderStats() {
  const all = Object.values(S.raw);
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
function openModal(sku) {
  const data = S.raw[sku];
  if (!data) return;
  const p = { sku, ...data };
  S.current = sku;

  const nombre = p.nombre || sku;
  const ean    = (typeof p.ean === 'string' && p.ean.length > 0) ? p.ean : '';

  // Galería de imágenes
  const imgs = [p.imagen1, p.imagen2].filter(Boolean);
  const gallery = imgs.length
    ? imgs.map((u, i) => `
        <img src="${esc(u)}" alt="Imagen ${i + 1}"
             data-url="${esc(u)}"
             loading="lazy"
             onclick="openLightbox(this.dataset.url)"
             onerror="imgShErr(this)">`
      ).join('')
    : `<div class="sh-img-ph"><i class="bi bi-image"></i><span>Sin imágenes</span></div>`;

  g('sheetBody').innerHTML = `
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

    <!-- INFO -->
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
        <div>
          <div class="ios-lbl">Categoría</div>
          <div class="ios-val">${esc(p.categoria)}</div>
        </div>
      </div>` : ''}

      ${p.stock !== undefined && p.stock !== null ? `
      <div class="ios-row">
        <div class="ios-icon ic-teal"><i class="bi bi-boxes"></i></div>
        <div>
          <div class="ios-lbl">Stock</div>
          <div class="ios-val">${Number(p.stock).toLocaleString('es-AR')} unidades</div>
        </div>
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
    </div>

    <!-- SCANNER -->
    <div class="scan-wrap">
      <div class="scan-card">
        <div class="scan-lbl"><i class="bi bi-upc-scan"></i> Escanear / Ingresar EAN13</div>
        <div class="ean-field" id="eanField">
          <span class="ean-field-icon"><i class="bi bi-upc-scan"></i></span>
          <input id="eanInput" class="ean-input"
                 type="tel" inputmode="numeric" pattern="[0-9]*"
                 placeholder="Apuntá el scanner y escaneá…"
                 maxlength="13" autocomplete="off"
                 value="${esc(ean)}">
          <span class="ean-count" id="eanCount">${ean.length}/13</span>
        </div>
        <div class="ean-hint">
          <i class="bi bi-bluetooth"></i>
          Conectá el scanner Bluetooth y escaneá el código de barras
        </div>
      </div>
    </div>

    <!-- ACCIONES -->
    <div class="act-wrap">
      <button class="act-btn btn-save" id="btnSave" onclick="saveEAN()" ${ean.length === 13 ? '' : 'disabled'}>
        <i class="bi bi-cloud-arrow-up-fill"></i> Guardar EAN
      </button>
      ${ean ? `
      <button class="act-btn btn-del" onclick="confirmDeleteEAN()">
        <i class="bi bi-trash3-fill"></i> Eliminar EAN
      </button>` : ''}
    </div>
  `;

  initEANField();

  g('backdrop').classList.add('open');
  g('sheet').classList.add('open');

  // Focus el input para el scanner Bluetooth
  setTimeout(() => g('eanInput')?.focus(), 420);
}

function closeModal() {
  g('backdrop').classList.remove('open');
  g('sheet').classList.remove('open');
  S.current = null;
}

// ── EAN INPUT ─────────────────────────────────────────────────────
function initEANField() {
  const inp     = g('eanInput');
  const field   = g('eanField');
  const count   = g('eanCount');
  const btnSave = g('btnSave');
  if (!inp) return;

  inp.addEventListener('input', () => {
    // Solo dígitos, máximo 13
    inp.value = inp.value.replace(/\D/g, '').slice(0, 13);
    const n = inp.value.length;
    count.textContent = `${n}/13`;

    field.classList.remove('valid', 'error');
    count.classList.remove('valid', 'error');

    if (n === 13) {
      field.classList.add('valid');
      count.classList.add('valid');
      btnSave.disabled = false;
    } else if (n > 0) {
      field.classList.add('error');
      count.classList.add('error');
      btnSave.disabled = true;
    } else {
      btnSave.disabled = true;
    }
  });

  // Enter → guardar (el scanner envía Enter después del código)
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!btnSave.disabled) saveEAN();
    }
  });

  // Validar valor pre-cargado
  if (inp.value) inp.dispatchEvent(new Event('input'));
}

// ── FIREBASE OPS ──────────────────────────────────────────────────
async function saveEAN() {
  const ean = g('eanInput')?.value?.trim() || '';

  if (!/^\d{13}$/.test(ean)) {
    showToast('EAN inválido: se necesitan exactamente 13 dígitos', 'error');
    return;
  }

  const sku = S.current;
  if (!sku) return;

  const btn = g('btnSave');
  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Guardando…';

  try {
    const r = await fetch(`${DB}/${encodeURIComponent(sku)}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ean }),
    });
    if (!r.ok) throw new Error(r.status);

    S.raw[sku].ean = ean;
    compute();
    showToast(`EAN ${ean} guardado correctamente`, 'success');
    setTimeout(closeModal, 900);
  } catch (e) {
    console.error('Error guardando EAN:', e);
    showToast('Error al guardar. Verificá la conexión.', 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-cloud-arrow-up-fill"></i> Guardar EAN';
  }
}

function confirmDeleteEAN() {
  const sku = S.current;
  if (!sku) return;
  const nombre = S.raw[sku]?.nombre || sku;
  if (!confirm(`¿Eliminar el EAN del producto "${nombre}"?`)) return;
  deleteEAN();
}

async function deleteEAN() {
  const sku = S.current;
  if (!sku) return;

  try {
    const r = await fetch(`${DB}/${encodeURIComponent(sku)}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ean: null }),
    });
    if (!r.ok) throw new Error(r.status);

    S.raw[sku].ean = '';
    compute();
    showToast('EAN eliminado correctamente', 'success');
    setTimeout(closeModal, 700);
  } catch (e) {
    console.error('Error eliminando EAN:', e);
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
  btn?.classList.add('active');
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

// ── BLUETOOTH / SCANNER DETECTION ────────────────────────────────
// Los scanners Bluetooth (HID) envían cada dígito en <60ms.
// Un humano tipeando rara vez baja de 150ms entre teclas.
// Si detectamos ≥3 caracteres consecutivos con delta <70ms → scanner activo.
function initBluetooth() {
  let lastMs    = 0;
  let rapidSeq  = 0;
  let idleTimer = null;

  const RAPID_MS   = 70;    // umbral de "carácter de scanner"
  const SEQ_NEEDED = 3;     // cuántos chars rápidos seguidos para confirmar
  const IDLE_MS    = 45000; // sin actividad → desconectado

  function onKey(e) {
    // Solo caracteres imprimibles, sin modificadores de sistema
    if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;

    const now   = Date.now();
    const delta = now - lastMs;
    lastMs = now;

    if (delta < RAPID_MS) {
      rapidSeq++;
      if (rapidSeq >= SEQ_NEEDED) setBTPill(true);
    } else {
      rapidSeq = 0;
    }

    // Reiniciar temporizador de inactividad cada vez que llega un caracter
    if (g('btPill').classList.contains('connected')) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => setBTPill(false), IDLE_MS);
    }
  }

  // Escuchar globalmente: funciona cuando el input está enfocado
  // y también detecta actividad del scanner con modal abierto
  document.addEventListener('keydown', onKey);
}

function setBTPill(connected) {
  const pill = g('btPill');
  if (!pill) return;
  pill.classList.toggle('connected', connected);
  pill.querySelector('.bt-text').textContent = connected ? 'Conectada' : 'Sin dispositivo';
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
