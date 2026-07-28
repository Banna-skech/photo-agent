/**
 * 员工照片批量处理工具 — 纯浏览器端
 */
const CANVAS_W = 1080, CANVAS_H = 1440, JPEG_Q = 0.92;

// ====== DOM ======
const $ = (s) => document.querySelector(s);
const uploadZone = $('#uploadZone'), fileInput = $('#fileInput');
const fileListSection = $('#fileListSection'), fileList = $('#fileList'), fileCount = $('#fileCount');
const processBtn = $('#processBtn'), downloadZipBtn = $('#downloadZipBtn');
const engineStatus = $('#engineStatus'), progressSection = $('#progressSection');
const progressList = $('#progressList'), resultsSection = $('#resultsSection'), resultsGrid = $('#resultsGrid');
const badgeTM = $('#badgeTopMargin'), plateTM = $('#plateTopMargin');
const smoothEl = $('#smoothStrength'), brightEl = $('#brightness');
const badgeTMV = $('#badgeTopMarginVal'), plateTMV = $('#plateTopMarginVal');
const smoothV = $('#smoothStrengthVal'), brightV = $('#brightnessVal');

// ====== State ======
const state = { files: [], results: [], processing: false };
let removeBgFn = null;

// ====== Settings ======
[{el: badgeTM, v: badgeTMV}, {el: plateTM, v: plateTMV},
 {el: smoothEl, v: smoothV}, {el: brightEl, v: brightV}]
  .forEach(({el, v}) => { el.oninput = () => v.textContent = el.value + '%'; });

// ====== Engine ======
(async () => {
  try {
    const m = await import('@imgly/background-removal');
    removeBgFn = m.removeBackground || m.default;
    engineStatus.innerHTML = '<span class="status-dot ready"></span><span>AI 抠图引擎就绪</span>';
  } catch (e) {
    engineStatus.innerHTML = '<span class="status-dot ready" style="background:var(--warning)"></span><span>AI 不可用，跳过抠图</span><span class="status-hint">需白底原图</span>';
  }
  updateBtn();
})();

function updateBtn() {
  processBtn.disabled = state.files.length === 0 || state.processing;
  processBtn.textContent = state.files.length ? `🚀 开始处理 (${state.files.length} 张)` : '🚀 开始处理';
}

// ====== File management ======
function addFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/') && !/\.(heic|heif)$/i.test(f.name)) continue;
    if (state.files.some(x => x.name === f.name)) continue;
    state.files.push({ name: f.name, file: f });
  }
  if (state.files.length) { fileListSection.style.display = 'block'; renderFiles(); }
  updateBtn();
}
function removeFile(i) {
  state.files.splice(i, 1);
  if (!state.files.length) fileListSection.style.display = 'none';
  renderFiles(); updateBtn();
}
function renderFiles() {
  fileCount.textContent = state.files.length + ' 张';
  fileList.innerHTML = state.files.map((f, i) =>
    `<div class="file-tag"><span>${esc(f.name)}</span><button class="remove-btn" data-i="${i}">×</button></div>`
  ).join('');
  fileList.querySelectorAll('.remove-btn').forEach(b => b.onclick = e => { e.stopPropagation(); removeFile(+b.dataset.i); });
}

uploadZone.onclick = () => fileInput.click();
fileInput.onchange = () => addFiles(fileInput.files);
uploadZone.ondragover = e => { e.preventDefault(); uploadZone.classList.add('drag-over'); };
uploadZone.ondragleave = () => uploadZone.classList.remove('drag-over');
uploadZone.ondrop = e => { e.preventDefault(); uploadZone.classList.remove('drag-over'); addFiles(e.dataTransfer.files); };
$('#clearFiles').onclick = () => {
  state.files = []; state.results = [];
  fileListSection.style.display = 'none'; progressSection.style.display = 'none';
  resultsSection.style.display = 'none'; downloadZipBtn.style.display = 'none';
  renderFiles(); updateBtn();
};

// ====== Image utils ======
function loadImg(blob) { return new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = URL.createObjectURL(blob); }); }
function toJpeg(cvs) { return new Promise(ok => cvs.toBlob(ok, 'image/jpeg', JPEG_Q)); }

function shrink(img, max) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (Math.max(w, h) <= max) { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0); return c; }
  const s = max / Math.max(w, h);
  const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// ====== Fast beautify on 1080x1440 canvas ======
function beautify(canvas) {
  const smooth = parseInt(smoothEl.value), bright = parseInt(brightEl.value);
  if (smooth <= 0 && bright <= 0) return;
  const w = canvas.width, h = canvas.height;

  // blur layer
  const blur = document.createElement('canvas'); blur.width = w; blur.height = h;
  const bctx = blur.getContext('2d');
  bctx.filter = `blur(${Math.max(1, (smooth / 100) * 6)}px)`;
  bctx.drawImage(canvas, 0, 0); bctx.filter = 'none';

  // blend
  const ctx = canvas.getContext('2d');
  ctx.globalAlpha = smooth / 100; ctx.drawImage(blur, 0, 0); ctx.globalAlpha = 1;

  // whitening — operate on final small canvas (fast)
  if (bright > 0) {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.min(255, d[i] * (1 + bright / 150));
      d[i + 1] = Math.min(255, d[i + 1] * (1 + bright / 150));
      d[i + 2] = Math.min(255, d[i + 2] * (1 + bright / 150));
    }
    ctx.putImageData(new ImageData(d, w, h), 0, 0);
  }
}

// ====== Compose photo onto 1080x1440 canvas ======
function compose(srcCanvas, topPct) {
  // Fast content-bound scan (coarse step)
  const ctx = srcCanvas.getContext('2d');
  const w = srcCanvas.width, h = srcCanvas.height;
  const step = Math.max(4, Math.min(w, h) >> 7);
  const data = ctx.getImageData(0, 0, w, h).data;
  let L = w, T = h, R = 0, B = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) {
        if (x < L) L = x; if (y < T) T = y;
        if (x > R) R = x; if (y > B) B = y;
      }
    }
  }
  if (R <= L || B <= T) { L = 0; T = 0; R = w - 1; B = h - 1; }
  const pw = R - L + 1, ph = B - T + 1;

  // Scale: target width = 60% of canvas
  let scale = (CANVAS_W * 0.6) / pw, scaledW = pw * scale | 0, scaledH = ph * scale | 0;
  let top = (CANVAS_H * topPct / 100) | 0, left = ((CANVAS_W - scaledW) / 2) | 0;
  if (top + scaledH > CANVAS_H) { scale = (CANVAS_H - top) / ph; scaledW = pw * scale | 0; scaledH = ph * scale | 0; left = ((CANVAS_W - scaledW) / 2) | 0; }
  if (left < 0) left = 0;

  const out = document.createElement('canvas'); out.width = CANVAS_W; out.height = CANVAS_H;
  const octx = out.getContext('2d');
  octx.fillStyle = '#FFF'; octx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  octx.drawImage(srcCanvas, L, T, pw, ph, left, top, scaledW, scaledH);
  return out;
}

// ====== Process one photo ======
async function processOne(file) {
  const name = file.name.replace(/\.(jpg|jpeg|png|heic|heif|webp)$/i, '');
  const pi = createProgress(name);
  const up = (pct, status) => {
    const fill = pi.querySelector('.progress-bar-fill'), icon = pi.querySelector('.status-icon');
    fill.style.width = pct + '%';
    if (status === 'done') { fill.classList.add('done'); icon.textContent = '✓'; }
    if (status === 'error') { fill.classList.add('error'); icon.textContent = '✗'; }
    pi.querySelector('.progress-pct').textContent = pct + '%';
  };

  try {
    up(5); const img = await loadImg(file);
    up(10); const src = shrink(img, 1080); // AI 抠图只需要 1080px 输入

    let fgImg = img;
    if (removeBgFn) {
      up(15);
      const jpg = await toJpeg(src); // 小体积 Blob 传给 AI
      try {
        const r = await removeBgFn(jpg, { model: 'isnet_quint8', output: { format: 'image/png' } });
        fgImg = await loadImg(r);
      } catch (e) { console.warn('AI fail:', e.message); }
    }
    up(50);

    // 白底合成（AI输出分辨率）
    const fgw = fgImg.naturalWidth || fgImg.width, fgh = fgImg.naturalHeight || fgImg.height;
    const bg = document.createElement('canvas'); bg.width = fgw; bg.height = fgh;
    const bgctx = bg.getContext('2d');
    bgctx.fillStyle = '#FFF'; bgctx.fillRect(0, 0, fgw, fgh);
    bgctx.drawImage(fgImg, 0, 0);
    up(55);

    // 合成 → 1080×1440
    const badge = compose(bg, parseFloat(badgeTM.value));
    // 在最终小画布上做美容（极快）
    beautify(badge);
    up(75);
    const badgeBlob = await toJpeg(badge);

    const plate = compose(bg, parseFloat(plateTM.value));
    beautify(plate);
    up(90);
    const plateBlob = await toJpeg(plate);
    up(100, 'done');

    return { name, badgeBlob, plateBlob, error: null };
  } catch (e) {
    console.error(name, e);
    up(100, 'error');
    return { name, badgeBlob: null, plateBlob: null, error: e.message };
  }
}

function createProgress(name) {
  const d = document.createElement('div'); d.className = 'progress-item';
  d.innerHTML = `<div class="progress-label"><span>${esc(name)}</span><span><span class="status-icon">⏳</span> <span class="progress-pct">0%</span></span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:0%"></div></div>`;
  progressList.appendChild(d);
  return d;
}

// ====== Batch ======
processBtn.onclick = async () => {
  if (state.processing || !state.files.length) return;
  state.processing = true; state.results = [];
  progressSection.style.display = 'block'; resultsSection.style.display = 'none';
  downloadZipBtn.style.display = 'none'; progressList.innerHTML = '';
  updateBtn(); processBtn.textContent = '⏳ 处理中...'; processBtn.disabled = true;

  for (const f of state.files) state.results.push(await processOne(f.file));

  renderResults();
  resultsSection.style.display = 'block';
  downloadZipBtn.style.display = state.results.some(r => !r.error) ? 'inline-flex' : 'none';
  state.processing = false; updateBtn();
};

function renderResults() {
  resultsGrid.innerHTML = state.results.map((r, i) => {
    if (r.error) return `<div class="result-card"><div class="card-header">${esc(r.name)} <span style="color:var(--danger)">失败</span></div><div class="card-body"><p style="color:var(--gray-500);font-size:13px">${esc(r.error)}</p></div></div>`;
    const bu = URL.createObjectURL(r.badgeBlob), pu = URL.createObjectURL(r.plateBlob);
    return `<div class="result-card">
      <div class="card-header"><span>${esc(r.name)}</span><span style="color:var(--success);font-size:12px">✓</span></div>
      <div class="card-body"><div class="preview-pair">
        <div class="preview-item"><img src="${bu}" alt="工牌照" loading="lazy"><div class="label">工牌照</div></div>
        <div class="preview-item"><img src="${pu}" alt="座位牌" loading="lazy"><div class="label">座位牌</div></div>
      </div></div>
      <div class="card-actions">
        <button class="btn btn-outline btn-sm dl" data-i="${i}" data-t="badge">⬇ 工牌照</button>
        <button class="btn btn-outline btn-sm dl" data-i="${i}" data-t="plate">⬇ 座位牌</button>
      </div></div>`;
  }).join('');
  resultsGrid.querySelectorAll('.dl').forEach(b => b.onclick = () => {
    const r = state.results[+b.dataset.i];
    download(r[b.dataset.t === 'badge' ? 'badgeBlob' : 'plateBlob'], `${r.name}-${b.dataset.t === 'badge' ? '工牌照' : '座位牌'}.jpg`);
  });
}

// ====== ZIP ======
downloadZipBtn.onclick = async () => {
  const ok = state.results.filter(r => !r.error);
  if (!ok.length) return;
  downloadZipBtn.textContent = '⏳ 打包中...'; downloadZipBtn.disabled = true;
  const zip = new JSZip();
  const bf = zip.folder('工牌照'), pf = zip.folder('座位牌');
  for (const r of ok) { bf.file(`${r.name}-工牌照.jpg`, r.badgeBlob); pf.file(`${r.name}-座位牌.jpg`, r.plateBlob); }
  const blob = await zip.generateAsync({ type: 'blob' });
  const d = new Date();
  download(blob, `员工照片_${d.getFullYear()}${('0'+(d.getMonth()+1)).slice(-2)}${('0'+d.getDate()).slice(-2)}.zip`);
  downloadZipBtn.textContent = '📦 下载全部 (ZIP)'; downloadZipBtn.disabled = false;
};

function download(blob, name) {
  const u = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(u);
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
