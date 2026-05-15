/* ============================================================
   CINEMATRIX — IMDb Data Stories
   Procesa title.basics.tsv y title.ratings.tsv en el cliente
   ============================================================ */

const CONFIG = {
  // Rutas relativas al index.html en el repo
  // Subí los TSV descomprimidos a /data/ en tu repo
  basicsURL:  'data/title.basics.tsv',
  ratingsURL: 'data/title.ratings.tsv',

  // Filtros para reducir ruido
  minVotes: 1000,           // mínimo de votos para que un título cuente
  titleTypes: ['movie'],    // solo películas (no series ni shorts)
  minYear: 1920,
  maxYear: 2024,
};

// ---------- UTILIDADES ----------
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

const fmtNum = n => {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
};

const setStatus = (msg, pct) => {
  $('#loader-status').textContent = msg;
  if (pct != null) $('#loader-bar-fill').style.width = pct + '%';
};

// ---------- STREAMING TSV PARSER ----------
async function streamTSV(url, onRow, onProgress) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`No pude leer ${url} (HTTP ${resp.status})`);

  const contentLength = +resp.headers.get('Content-Length') || 0;
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let received = 0;
  let buffer = '';
  let isFirstLine = true;
  let headers = [];
  let rowCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    buffer += decoder.decode(value, { stream: true });

    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (isFirstLine) {
        headers = line.split('\t');
        isFirstLine = false;
        continue;
      }
      const cols = line.split('\t');
      onRow(cols, headers);
      rowCount++;
      if (rowCount % 100000 === 0 && onProgress && contentLength) {
        onProgress(received / contentLength, rowCount);
        // ceder el event loop así no se traba la UI
        await new Promise(r => setTimeout(r, 0));
      }
    }
  }
  // última línea si no terminó en \n
  if (buffer.trim()) {
    const cols = buffer.split('\t');
    onRow(cols, headers);
  }
  return rowCount;
}

// ---------- CARGA DE DATOS ----------
async function loadData() {
  // 1. Ratings primero (chico)
  setStatus('Cargando ratings...', 5);
  const ratings = new Map(); // tconst -> { rating, votes }
  await streamTSV(CONFIG.ratingsURL, (cols) => {
    // tconst averageRating numVotes
    const tconst = cols[0];
    const rating = parseFloat(cols[1]);
    const votes = parseInt(cols[2], 10);
    if (votes >= CONFIG.minVotes) {
      ratings.set(tconst, { rating, votes });
    }
  }, (p, n) => setStatus(`Ratings: ${fmtNum(n)} filas`, 5 + p * 15));

  setStatus(`${fmtNum(ratings.size)} títulos con votos suficientes`, 20);

  // 2. Basics (grande, se hace join al vuelo)
  setStatus('Cargando metadata de películas...', 22);
  const titles = []; // { tconst, primaryTitle, year, decade, runtime, genres[], rating, votes }
  await streamTSV(CONFIG.basicsURL, (cols) => {
    // tconst titleType primaryTitle originalTitle isAdult startYear endYear runtimeMinutes genres
    const tconst = cols[0];
    const r = ratings.get(tconst);
    if (!r) return;
    const titleType = cols[1];
    if (!CONFIG.titleTypes.includes(titleType)) return;
    const isAdult = cols[4] === '1';
    if (isAdult) return;
    const year = parseInt(cols[5], 10);
    if (!year || year < CONFIG.minYear || year > CONFIG.maxYear) return;
    const runtime = parseInt(cols[7], 10);
    const genres = cols[8] === '\\N' ? [] : cols[8].split(',');

    titles.push({
      tconst,
      title: cols[2],
      year,
      decade: Math.floor(year / 10) * 10,
      runtime: isNaN(runtime) ? null : runtime,
      genres,
      rating: r.rating,
      votes: r.votes,
    });
  }, (p, n) => setStatus(`Películas: ${fmtNum(n)} filas escaneadas`, 22 + p * 65));

  setStatus(`${fmtNum(titles.length)} películas filtradas`, 90);
  return titles;
}

// ============================================================
// MÉTRICA 1 — HEATMAP década × duración → rating
// ============================================================
function computeHeatmap(titles) {
  const decades = [];
  for (let d = 1930; d <= 2020; d += 10) decades.push(d);
  const runtimeBins = [
    { label: '<80', min: 0,   max: 79  },
    { label: '80-99', min: 80,  max: 99  },
    { label: '100-119', min: 100, max: 119 },
    { label: '120-139', min: 120, max: 139 },
    { label: '140-159', min: 140, max: 159 },
    { label: '160+', min: 160, max: Infinity },
  ];

  const grid = {}; // key "decade-binIdx" -> { sum, n }
  for (const t of titles) {
    if (t.runtime == null) continue;
    if (t.decade < 1930 || t.decade > 2020) continue;
    const binIdx = runtimeBins.findIndex(b => t.runtime >= b.min && t.runtime <= b.max);
    if (binIdx === -1) continue;
    const key = `${t.decade}-${binIdx}`;
    if (!grid[key]) grid[key] = { sum: 0, n: 0 };
    grid[key].sum += t.rating;
    grid[key].n += 1;
  }
  const cells = [];
  for (const d of decades) {
    for (let bi = 0; bi < runtimeBins.length; bi++) {
      const c = grid[`${d}-${bi}`];
      cells.push({
        decade: d,
        binIdx: bi,
        binLabel: runtimeBins[bi].label,
        avg: c && c.n >= 20 ? c.sum / c.n : null,
        count: c ? c.n : 0,
      });
    }
  }
  return { cells, decades, runtimeBins };
}

function renderHeatmap(data) {
  const { cells, decades, runtimeBins } = data;
  const W = 900, H = 380;
  const margin = { top: 30, right: 20, bottom: 50, left: 90 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;
  const cellW = innerW / decades.length;
  const cellH = innerH / runtimeBins.length;

  const validAvgs = cells.filter(c => c.avg != null).map(c => c.avg);
  const min = Math.min(...validAvgs);
  const max = Math.max(...validAvgs);

  // Paleta heat (peor → mejor)
  const heatColors = ['#2a1f2e', '#4a2540', '#823654', '#c14d52', '#e8a04c', '#f4e285'];
  const colorFor = avg => {
    if (avg == null) return '#1a1a1f';
    const t = (avg - min) / (max - min);
    const idx = Math.min(heatColors.length - 1, Math.floor(t * heatColors.length));
    return heatColors[idx];
  };

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
  svg += `<g transform="translate(${margin.left},${margin.top})">`;

  // Cells
  cells.forEach(c => {
    const x = decades.indexOf(c.decade) * cellW;
    const y = c.binIdx * cellH;
    const fill = colorFor(c.avg);
    const tip = c.avg != null
      ? `${c.decade}s · ${c.binLabel} min<br><strong>${c.avg.toFixed(2)} ★</strong> · ${c.count} pelis`
      : `${c.decade}s · ${c.binLabel} min<br>Sin datos suficientes`;
    svg += `<rect class="heat-cell" x="${x+1}" y="${y+1}" width="${cellW-2}" height="${cellH-2}" fill="${fill}" data-tip="${tip}"/>`;
    if (c.avg != null && cellW > 50) {
      svg += `<text x="${x + cellW/2}" y="${y + cellH/2 + 4}" text-anchor="middle" fill="${c.avg > (min+max)/2 ? '#0a0a0b' : '#f4f1ea'}" font-family="JetBrains Mono" font-size="11" font-weight="500" pointer-events="none">${c.avg.toFixed(1)}</text>`;
    }
  });

  // Y axis labels (runtime bins)
  svg += `<g class="axis">`;
  runtimeBins.forEach((b, i) => {
    svg += `<text x="-10" y="${i * cellH + cellH/2 + 4}" text-anchor="end">${b.label}</text>`;
  });
  svg += `<text x="-70" y="${innerH/2}" transform="rotate(-90, -70, ${innerH/2})" text-anchor="middle" fill="#a8a39a" font-family="JetBrains Mono" font-size="10" letter-spacing="2">DURACIÓN (min)</text>`;
  svg += `</g>`;

  // X axis labels (decades)
  svg += `<g class="axis">`;
  decades.forEach((d, i) => {
    svg += `<text x="${i * cellW + cellW/2}" y="${innerH + 20}" text-anchor="middle">${d}s</text>`;
  });
  svg += `<text x="${innerW/2}" y="${innerH + 42}" text-anchor="middle" fill="#a8a39a" font-family="JetBrains Mono" font-size="10" letter-spacing="2">DÉCADA DE ESTRENO</text>`;
  svg += `</g>`;

  svg += `</g></svg>`;
  $('#chart-heatmap').innerHTML = svg;

  // Insight automático: ¿qué bin de duración tiene mejor rating promedio en general?
  const binAvgs = runtimeBins.map((b, bi) => {
    const c = cells.filter(c => c.binIdx === bi && c.avg != null);
    const w = c.reduce((s, x) => s + x.count, 0);
    const r = c.reduce((s, x) => s + x.avg * x.count, 0);
    return { label: b.label, avg: w ? r / w : 0, n: w };
  });
  const best = binAvgs.reduce((a, b) => a.avg > b.avg ? a : b);
  const worst = binAvgs.reduce((a, b) => a.avg < b.avg ? a : b);
  $('#insight-1').innerHTML = `Las películas de <strong>${best.label} minutos</strong> tienen el rating promedio más alto (${best.avg.toFixed(2)} ★), mientras las de <strong>${worst.label}</strong> son las peor evaluadas (${worst.avg.toFixed(2)} ★). Diferencia: ${(best.avg - worst.avg).toFixed(2)} puntos.`;

  attachTooltip('#chart-heatmap');
}

// ============================================================
// MÉTRICA 2 — Rating por género × década
// ============================================================
function computeGenresOverTime(titles) {
  const decades = [];
  for (let d = 1930; d <= 2020; d += 10) decades.push(d);

  // Tomar top-N géneros por cantidad total de pelis
  const genreCount = {};
  for (const t of titles) {
    for (const g of t.genres) {
      genreCount[g] = (genreCount[g] || 0) + 1;
    }
  }
  const topGenres = Object.entries(genreCount)
    .filter(([g]) => g && g !== '\\N')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(x => x[0]);

  // avg rating por género × década
  const grid = {}; // genre -> decade -> { sum, n }
  for (const g of topGenres) grid[g] = {};
  for (const t of titles) {
    if (t.decade < 1930 || t.decade > 2020) continue;
    for (const g of t.genres) {
      if (!topGenres.includes(g)) continue;
      if (!grid[g][t.decade]) grid[g][t.decade] = { sum: 0, n: 0 };
      grid[g][t.decade].sum += t.rating;
      grid[g][t.decade].n += 1;
    }
  }
  const series = topGenres.map(g => ({
    genre: g,
    points: decades.map(d => {
      const c = grid[g][d];
      return { decade: d, avg: c && c.n >= 30 ? c.sum / c.n : null, n: c ? c.n : 0 };
    }).filter(p => p.avg != null),
  })).filter(s => s.points.length >= 4);

  return { series, decades };
}

const GENRE_COLORS = ['#e50914', '#f5a623', '#4a90e2', '#7ed321', '#bd10e0', '#50e3c2', '#f8e71c', '#ff6b9d'];

function renderGenres(data) {
  const { series, decades } = data;
  const W = 900, H = 420;
  const margin = { top: 30, right: 20, bottom: 50, left: 50 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;

  const allAvgs = series.flatMap(s => s.points.map(p => p.avg));
  const yMin = Math.floor(Math.min(...allAvgs) * 2) / 2;
  const yMax = Math.ceil(Math.max(...allAvgs) * 2) / 2;

  const xScale = d => ((d - decades[0]) / (decades[decades.length-1] - decades[0])) * innerW;
  const yScale = v => innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
  svg += `<g transform="translate(${margin.left},${margin.top})">`;

  // Gridlines Y
  svg += `<g class="grid">`;
  const ySteps = 5;
  for (let i = 0; i <= ySteps; i++) {
    const v = yMin + (yMax - yMin) * (i / ySteps);
    const y = yScale(v);
    svg += `<line x1="0" y1="${y}" x2="${innerW}" y2="${y}" />`;
    svg += `<text x="-8" y="${y+4}" text-anchor="end" fill="#a8a39a" font-family="JetBrains Mono" font-size="10">${v.toFixed(1)}</text>`;
  }
  svg += `</g>`;

  // X axis
  svg += `<g class="axis">`;
  decades.forEach(d => {
    const x = xScale(d);
    svg += `<text x="${x}" y="${innerH + 20}" text-anchor="middle">${d}s</text>`;
  });
  svg += `</g>`;

  // Lines
  series.forEach((s, i) => {
    const color = GENRE_COLORS[i % GENRE_COLORS.length];
    const pathD = s.points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${xScale(p.decade)} ${yScale(p.avg)}`).join(' ');
    svg += `<path class="genre-line" data-genre="${s.genre}" d="${pathD}" stroke="${color}" />`;
    s.points.forEach(p => {
      svg += `<circle class="scatter-dot" cx="${xScale(p.decade)}" cy="${yScale(p.avg)}" r="3.5" fill="${color}" data-tip="<strong>${s.genre}</strong>${p.decade}s · ${p.avg.toFixed(2)} ★ · ${p.n} pelis"/>`;
    });
  });

  svg += `</g></svg>`;
  $('#chart-lines').innerHTML = svg;

  // Legend
  const legend = $('#legend-genres');
  legend.innerHTML = '';
  series.forEach((s, i) => {
    const color = GENRE_COLORS[i % GENRE_COLORS.length];
    const item = document.createElement('div');
    item.className = 'genre-legend__item';
    item.dataset.genre = s.genre;
    item.innerHTML = `<span class="genre-legend__swatch" style="background:${color}"></span>${s.genre}`;
    item.addEventListener('mouseenter', () => highlightGenre(s.genre));
    item.addEventListener('mouseleave', () => highlightGenre(null));
    legend.appendChild(item);
  });

  // Insight: ¿qué género subió más entre primera y última década?
  let bestRise = { genre: null, delta: -Infinity };
  let bestFall = { genre: null, delta:  Infinity };
  series.forEach(s => {
    const first = s.points[0].avg;
    const last = s.points[s.points.length - 1].avg;
    const delta = last - first;
    if (delta > bestRise.delta) bestRise = { genre: s.genre, delta, first, last };
    if (delta < bestFall.delta) bestFall = { genre: s.genre, delta, first, last };
  });
  $('#insight-2').innerHTML = `<strong>${bestRise.genre}</strong> es el género que más mejoró: de ${bestRise.first.toFixed(2)} ★ a ${bestRise.last.toFixed(2)} ★ (+${bestRise.delta.toFixed(2)}). En cambio, <strong>${bestFall.genre}</strong> cayó ${Math.abs(bestFall.delta).toFixed(2)} puntos en el mismo período.`;

  attachTooltip('#chart-lines');
}

function highlightGenre(genre) {
  $$('.genre-line').forEach(p => {
    p.classList.toggle('dim', genre && p.dataset.genre !== genre);
    p.classList.toggle('active', genre && p.dataset.genre === genre);
  });
  $$('.genre-legend__item').forEach(p => {
    p.classList.toggle('dim', genre && p.dataset.genre !== genre);
  });
}

// ============================================================
// MÉTRICA 3 — Scatter rating vs votos
// ============================================================
let scatterTitles = []; // referencia global
function renderScatter(titles, genreFilter = 'all') {
  const W = 900, H = 460;
  const margin = { top: 20, right: 20, bottom: 60, left: 50 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;

  // Filtrar
  let data = titles.filter(t => t.votes >= 5000);
  if (genreFilter !== 'all') {
    data = data.filter(t => t.genres.includes(genreFilter));
  }
  // Para no saturar el SVG, samplear si hay demasiados
  const MAX_POINTS = 4000;
  if (data.length > MAX_POINTS) {
    const step = data.length / MAX_POINTS;
    const sampled = [];
    for (let i = 0; i < data.length; i += step) sampled.push(data[Math.floor(i)]);
    // Pero siempre incluir los gems y los hits para que se vean en los extremos
    const top = [...data].sort((a, b) => b.rating - a.rating).slice(0, 50);
    const hits = [...data].sort((a, b) => b.votes - a.votes).slice(0, 50);
    data = [...new Set([...sampled, ...top, ...hits])];
  }

  const xLog = v => Math.log10(Math.max(v, 1));
  const xMin = xLog(5000);
  const xMax = xLog(Math.max(...titles.map(t => t.votes)));
  const xScale = v => ((xLog(v) - xMin) / (xMax - xMin)) * innerW;
  const yScale = r => innerH - ((r - 1) / 9) * innerH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
  svg += `<g transform="translate(${margin.left},${margin.top})">`;

  // Grid Y (rating)
  svg += `<g class="grid">`;
  for (let r = 1; r <= 10; r++) {
    const y = yScale(r);
    svg += `<line x1="0" y1="${y}" x2="${innerW}" y2="${y}" />`;
    svg += `<text x="-8" y="${y+4}" text-anchor="end" fill="#a8a39a" font-family="JetBrains Mono" font-size="10">${r}</text>`;
  }
  svg += `</g>`;

  // Grid X (votos log)
  svg += `<g class="axis">`;
  const xTicks = [1e4, 1e5, 1e6, 2e6];
  xTicks.forEach(v => {
    if (v < Math.pow(10, xMin) * 1.5) return;
    const x = xScale(v);
    svg += `<line x1="${x}" y1="0" x2="${x}" y2="${innerH}" stroke="#2a2a30" stroke-dasharray="2 4"/>`;
    svg += `<text x="${x}" y="${innerH + 20}" text-anchor="middle">${fmtNum(v)}</text>`;
  });
  svg += `<text x="${innerW/2}" y="${innerH + 42}" text-anchor="middle" fill="#a8a39a" font-family="JetBrains Mono" font-size="10" letter-spacing="2">CANTIDAD DE VOTOS (log)</text>`;
  svg += `<text x="-35" y="${innerH/2}" transform="rotate(-90, -35, ${innerH/2})" text-anchor="middle" fill="#a8a39a" font-family="JetBrains Mono" font-size="10" letter-spacing="2">RATING IMDb</text>`;
  svg += `</g>`;

  // Etiquetas de cuadrantes
  svg += `<text x="20" y="20" fill="#f5a623" font-family="JetBrains Mono" font-size="10" letter-spacing="2" opacity=".7">◤ HIDDEN GEMS</text>`;
  svg += `<text x="${innerW - 20}" y="20" text-anchor="end" fill="#e50914" font-family="JetBrains Mono" font-size="10" letter-spacing="2" opacity=".7">HITS MASIVOS ◥</text>`;

  // Puntos
  data.forEach(t => {
    const x = xScale(t.votes);
    const y = yScale(t.rating);
    // Color según cuadrante: arriba-izq = gem, arriba-der = hit, abajo = decepción
    let color = '#a8a39a';
    let r = 2;
    if (t.rating >= 8.0 && t.votes < 100000) { color = '#f5a623'; r = 3.5; }
    else if (t.rating >= 8.0 && t.votes >= 500000) { color = '#e50914'; r = 3.5; }
    else if (t.rating >= 7.5) { color = '#f4e285'; r = 2.5; }
    const tip = `<strong>${escapeHtml(t.title)}</strong>${t.year} · ${t.genres.slice(0,2).join(', ')}<br>★ ${t.rating} · ${fmtNum(t.votes)} votos`;
    svg += `<circle class="scatter-dot" cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity=".7" data-tip="${tip}"/>`;
  });

  svg += `</g></svg>`;
  $('#chart-scatter').innerHTML = svg;
  attachTooltip('#chart-scatter');

  // Top 4 gems (rating alto, pocos votos) — actualiza con filtro
  let pool = titles.filter(t => t.votes >= 5000 && t.votes < 100000 && t.rating >= 8.0);
  if (genreFilter !== 'all') pool = pool.filter(t => t.genres.includes(genreFilter));
  const gems = pool.sort((a, b) => b.rating - a.rating).slice(0, 4);
  $('#gems-list').innerHTML = '<p style="grid-column: 1/-1; font-family: var(--font-mono); font-size: .75rem; letter-spacing: .15em; text-transform: uppercase; color: var(--ink-soft); margin-bottom: -.5rem;">↓ Top hidden gems</p>' +
    gems.map(g => `
      <div class="gem">
        <div class="gem__rating">${g.rating}<span class="gem__star"> ★</span></div>
        <div class="gem__title">${escapeHtml(g.title)}</div>
        <div class="gem__meta">${g.year} · ${fmtNum(g.votes)} votos · ${g.genres.slice(0,2).join(', ')}</div>
      </div>
    `).join('');

  // Insight
  const totalHits = pool.length;
  const avgGems = gems.length ? (gems.reduce((s, g) => s + g.rating, 0) / gems.length).toFixed(2) : '—';
  $('#insight-3').innerHTML = `Hay <strong>${totalHits}</strong> joyas escondidas (rating ≥ 8.0 con menos de 100K votos) ${genreFilter === 'all' ? 'en total' : `en ${genreFilter}`}. Las 4 mejores promedian ${avgGems} ★ — comparable a los clásicos consagrados, pero con una fracción de la audiencia.`;
}

// ============================================================
// TOOLTIPS COMPARTIDOS
// ============================================================
let tooltipEl = null;
function ensureTooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'tooltip';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}
function attachTooltip(selector) {
  const root = $(selector);
  if (!root) return;
  const tip = ensureTooltip();
  root.addEventListener('mousemove', e => {
    const t = e.target.closest('[data-tip]');
    if (!t) { tip.classList.remove('show'); return; }
    tip.innerHTML = t.dataset.tip;
    tip.classList.add('show');
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + tw > window.innerWidth) x = e.clientX - tw - 14;
    if (y + th > window.innerHeight) y = e.clientY - th - 14;
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  });
  root.addEventListener('mouseleave', () => tip.classList.remove('show'));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ============================================================
// HERO STATS animados
// ============================================================
function animateNum(el, target, isFmt) {
  const dur = 1400;
  const start = performance.now();
  const tick = now => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    const val = Math.floor(target * eased);
    el.textContent = isFmt ? fmtNum(val) : val;
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = isFmt ? fmtNum(target) : target;
  };
  requestAnimationFrame(tick);
}

// ============================================================
// MAIN
// ============================================================
(async () => {
  try {
    const titles = await loadData();
    setStatus('Calculando métricas...', 92);
    scatterTitles = titles;

    // Hero stats
    const totalVotes = titles.reduce((s, t) => s + t.votes, 0);
    const years = new Set(titles.map(t => t.year)).size;
    animateNum($('#stat-titles'), titles.length, true);
    animateNum($('#stat-votes'), totalVotes, true);
    animateNum($('#stat-years'), years, false);

    // Render
    setStatus('Renderizando heatmap...', 94);
    renderHeatmap(computeHeatmap(titles));

    setStatus('Renderizando géneros...', 96);
    renderGenres(computeGenresOverTime(titles));

    setStatus('Renderizando scatter...', 98);
    // Llenar select de géneros
    const allGenres = new Set();
    titles.forEach(t => t.genres.forEach(g => g && allGenres.add(g)));
    const sel = $('#genre-filter');
    sel.innerHTML = '<option value="all">Todos los géneros</option>' +
      [...allGenres].sort().map(g => `<option value="${g}">${g}</option>`).join('');
    sel.addEventListener('change', e => renderScatter(scatterTitles, e.target.value));
    renderScatter(titles, 'all');

    setStatus('Listo', 100);
    setTimeout(() => $('#loader').classList.add('hidden'), 400);

    // Intersection observer para fade-in
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.1 });
    $$('.metric').forEach(m => { m.classList.add('fade-in'); io.observe(m); });

  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`, 100);
    $('#loader-status').style.color = '#e50914';
  }
})();
