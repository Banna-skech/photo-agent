/**
 * 员工照片批量处理 — 纯浏览器版
 */
const CW = 1080, CH = 1440, JQ = 0.92;

// ====== DOM ======
const $ = s => document.querySelector(s);
const E = {
  upZone: $('#uploadZone'),    fInp: $('#fileInput'),
  flSec: $('#fileListSection'), fl: $('#fileList'), fc: $('#fileCount'),
  proc: $('#processBtn'),      zip: $('#downloadZipBtn'),
  eng: $('#engineStatus'),     progSec: $('#progressSection'), progL: $('#progressList'),
  resSec: $('#resultsSection'), resG: $('#resultsGrid'),
  bTM: $('#badgeTopMargin'),   pTM: $('#plateTopMargin'),
  sm: $('#smoothStrength'),    br: $('#brightness'),
  bTMv: $('#badgeTopMarginVal'), pTMv: $('#plateTopMarginVal'),
  smv: $('#smoothStrengthVal'), brv: $('#brightnessVal'),
};

const S = { files: [], results: [], busy: false };
let rmBg = null;

// ====== Sliders ======
[{e: E.bTM, v: E.bTMv},{e: E.pTM, v: E.pTMv},{e: E.sm, v: E.smv},{e: E.br, v: E.brv}]
  .forEach(x => { x.e.oninput = () => x.v.textContent = x.e.value + '%'; });

// ====== AI Engine ======
(async () => {
  try {
    const m = await import('@imgly/background-removal');
    rmBg = m.removeBackground || m.default;
    E.eng.innerHTML = '<span class="status-dot ready"></span>AI 抠图引擎就绪';
  } catch (e) {
    E.eng.innerHTML = '<span class="status-dot ready" style="background:var(--warning)"></span>AI 不可用（需白底原图）';
  }
  upBtn();
})();

function upBtn() {
  E.proc.disabled = !S.files.length || S.busy;
  E.proc.textContent = S.files.length ? `🚀 开始处理 (${S.files.length} 张)` : '🚀 开始处理';
}

// ====== Files ======
function addFiles(fs) {
  for (const f of fs) {
    if (!f.type.startsWith('image/') && !/\.(heic|heif)$/i.test(f.name)) continue;
    if (S.files.some(x => x.name === f.name)) continue;
    S.files.push({ name: f.name, file: f });
  }
  if (S.files.length) { E.flSec.style.display = 'block'; renderF(); }
  upBtn();
}
function rmF(i) { S.files.splice(i,1); if(!S.files.length)E.flSec.style.display='none'; renderF(); upBtn(); }
function renderF() {
  E.fc.textContent = S.files.length + ' 张';
  E.fl.innerHTML = S.files.map((f,i) =>
    `<div class="file-tag"><span>${esc(f.name)}</span><button class="rm" data-i="${i}">×</button></div>`).join('');
  E.fl.querySelectorAll('.rm').forEach(b => b.onclick = e => { e.stopPropagation(); rmF(+b.dataset.i); });
}

E.upZone.onclick = () => E.fInp.click();
E.fInp.onchange = () => addFiles(E.fInp.files);
E.upZone.ondragover = e => { e.preventDefault(); E.upZone.classList.add('drag-over'); };
E.upZone.ondragleave = () => E.upZone.classList.remove('drag-over');
E.upZone.ondrop = e => { e.preventDefault(); E.upZone.classList.remove('drag-over'); addFiles(e.dataTransfer.files); };
$('#clearFiles').onclick = () => {
  S.files=[]; S.results=[]; E.flSec.style.display='none'; E.progSec.style.display='none';
  E.resSec.style.display='none'; E.zip.style.display='none'; renderF(); upBtn();
};

// ====== Image utils ======
function loadImg(b) { return new Promise((ok,er) => { const i=new Image(); i.onload=()=>ok(i); i.onerror=er; i.src=URL.createObjectURL(b); }); }
function toJpg(c) { return new Promise(ok => c.toBlob(ok,'image/jpeg',JQ)); }
function shrink(img, max) {
  const w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;
  if (Math.max(w,h) <= max) { const c=document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').drawImage(img,0,0); return c; }
  const s = max/Math.max(w,h);
  const c=document.createElement('canvas'); c.width=Math.round(w*s); c.height=Math.round(h*s);
  c.getContext('2d').drawImage(img,0,0,c.width,c.height); return c;
}

/**
 * 核心：用 AI 输出的 Alpha 通道做纯净白底
 *
 * AI 模型返回 RGBA PNG：
 *   Alpha = 0    → 模型100%确定是背景
 *   Alpha = 255  → 模型100%确定是前景（人）
 *   Alpha 中间值 → 边缘/头发/半透明区域
 *
 * 正确的做法：读取 Alpha 通道，按阈值二值化。
 * Alpha < 阈值的像素 → 纯白，Alpha >= 阈值的像素 → 保留原色。
 * 这比事后 RGB 阈值清理精确得多，因为 Alpha 就是模型的判断。
 */
function applyAlphaMask(rgbaCanvas, alphaThreshold) {
  const ctx = rgbaCanvas.getContext('2d');
  const w = rgbaCanvas.width, h = rgbaCanvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const thresh = alphaThreshold || 210;

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < thresh) {
      // 模型判定为背景 → 纯白
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
    }
    // 无论前景还是背景，最终都输出完全不透明
    d[i + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);

  // 二次：中值滤波去孤点（3×3 核，RGB 空间）
  medianFilter(ctx, w, h);
}

/**
 * 中值滤波：每个像素取 3×3 邻域中位数色值
 * 只影响孤立的噪点像素，不破坏大面积区域
 */
function medianFilter(ctx, w, h) {
  const src = ctx.getImageData(0, 0, w, h);
  const sd = src.data;
  const out = new ImageData(w, h);
  const od = out.data;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const ci = (y * w + x) * 4;
      const R = [], G = [], B = [];

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ni = ((y + dy) * w + (x + dx)) * 4;
          R.push(sd[ni]); G.push(sd[ni + 1]); B.push(sd[ni + 2]);
        }
      }

      R.sort((a, b) => a - b); G.sort((a, b) => a - b); B.sort((a, b) => a - b);
      od[ci] = R[4]; od[ci + 1] = G[4]; od[ci + 2] = B[4]; od[ci + 3] = 255;

      // 如果中位数是纯白，且原像素不是纯白 → 噪点，涂白
      if (od[ci] === 255 && od[ci + 1] === 255 && od[ci + 2] === 255) {
        if (sd[ci] < 250 || sd[ci + 1] < 250 || sd[ci + 2] < 250) {
          // 周围都是白，只有这个像素有色 → 噪点
        }
      }
    }
  }

  // 只替换被中值滤波判定为噪点的区域
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const ci = (y * w + x) * 4;
      // 原像素非白，中值滤波后变白 → 孤立噪点
      const wasNoise = (sd[ci] < 248 || sd[ci + 1] < 248 || sd[ci + 2] < 248) &&
        (od[ci] >= 248 && od[ci + 1] >= 248 && od[ci + 2] >= 248);
      if (wasNoise) {
        sd[ci] = od[ci]; sd[ci + 1] = od[ci + 1]; sd[ci + 2] = od[ci + 2];
      }
    }
  }

  ctx.putImageData(src, 0, 0);
}

// ====== Compose: crop + scale onto 1080x1440 ======
function compose(srcCanvas, bodyPct, topPct) {
  const ctx = srcCanvas.getContext('2d');
  const w = srcCanvas.width, h = srcCanvas.height;
  const step = Math.max(4, Math.min(w, h) >> 7);
  const raw = ctx.getImageData(0, 0, w, h).data;

  // Content bounds
  let L = w, T = h, R = 0, B = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (raw[i] < 245 || raw[i + 1] < 245 || raw[i + 2] < 245) {
        if (x < L) L = x; if (y < T) T = y;
        if (x > R) R = x; if (y > B) B = y;
      }
    }
  }
  if (R <= L) { L = 0; T = 0; R = w - 1; B = h - 1; }
  const pw = R - L + 1, ph = B - T + 1;

  // Crop to top bodyPct of person
  const cropH = Math.round(ph * bodyPct);

  // Scale to fill 87-93% of canvas height
  const targetH = CH * (bodyPct > 0.65 ? 0.93 : 0.87);
  const scale = targetH / cropH;
  const drawW = Math.round(pw * scale), drawH = Math.round(cropH * scale);

  let drawX = Math.round((CW - drawW) / 2), drawY = Math.round(CH * topPct / 100);
  if (drawX < 0) drawX = 0;
  if (drawY + drawH > CH) drawY = CH - drawH;
  if (drawY < 0) drawY = 0;

  const out = document.createElement('canvas'); out.width = CW; out.height = CH;
  const octx = out.getContext('2d');
  octx.fillStyle = '#FFF'; octx.fillRect(0, 0, CW, CH);
  octx.drawImage(srcCanvas, L, T, pw, cropH, drawX, drawY, drawW, drawH);

  return out;
}

// ====== Beautify (on 1080x1440) ======
function beautify(cvs) {
  const s = parseInt(E.sm.value), b = parseInt(E.br.value);
  if (s <= 0 && b <= 0) return;
  const w = cvs.width, h = cvs.height;

  const bl = document.createElement('canvas'); bl.width = w; bl.height = h;
  const bctx = bl.getContext('2d');
  bctx.filter = `blur(${Math.max(1, (s / 100) * 6)}px)`;
  bctx.drawImage(cvs, 0, 0); bctx.filter = 'none';

  const ctx = cvs.getContext('2d');
  ctx.globalAlpha = s / 100; ctx.drawImage(bl, 0, 0); ctx.globalAlpha = 1;

  if (b > 0) {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.min(255, d[i] * (1 + b / 150));
      d[i + 1] = Math.min(255, d[i + 1] * (1 + b / 150));
      d[i + 2] = Math.min(255, d[i + 2] * (1 + b / 150));
    }
    ctx.putImageData(new ImageData(d, w, h), 0, 0);
  }
}

// ====== Process one ======
async function procOne(file) {
  const name = file.name.replace(/\.(jpg|jpeg|png|heic|heif|webp)$/i, '');
  const pi = mkProg(name);
  const up = (pct, st) => {
    const f = pi.querySelector('.progress-bar-fill'), ic = pi.querySelector('.status-icon');
    f.style.width = pct + '%';
    if (st === 'done') { f.classList.add('done'); ic.textContent = '✓'; }
    if (st === 'err') { f.classList.add('error'); ic.textContent = '✗'; }
    pi.querySelector('.progress-pct').textContent = pct + '%';
  };

  try {
    // 1. Load & shrink
    up(5); const img = await loadImg(file);
    up(8); const srcCvs = shrink(img, 1080); // AI input ≤1080px

    // 2. AI background removal → RGBA PNG
    let rgbaCvs = null;
    if (rmBg) {
      up(12);
      const jpg = await toJpg(srcCvs);
      try {
        const blob = await rmBg(jpg, { model: 'isnet_quint8', output: { format: 'image/png' } });
        const fgImg = await loadImg(blob);

        // Draw RGBA PNG onto canvas (preserving alpha channel!)
        const cvs = document.createElement('canvas');
        cvs.width = fgImg.naturalWidth || fgImg.width;
        cvs.height = fgImg.naturalHeight || fgImg.height;
        cvs.getContext('2d').drawImage(fgImg, 0, 0);
        rgbaCvs = cvs;
      } catch (e) { console.warn('AI fail:', e.message); }
    }

    // Fallback: no AI → just the shrunk image
    if (!rgbaCvs) { rgbaCvs = srcCvs; }

    // 3. Apply alpha mask → pure white background
    up(35);
    applyAlphaMask(rgbaCvs, 200);
    up(50);

    // 4. Compose badge (top 55% of body, ~12% margin)
    const badgeCvs = compose(rgbaCvs, 0.55, parseFloat(E.bTM.value));
    beautify(badgeCvs);
    const badgeBlob = await toJpg(badgeCvs);
    up(75);

    // 5. Compose desk plate (top 68% of body, ~5% margin)
    const plateCvs = compose(rgbaCvs, 0.68, parseFloat(E.pTM.value));
    beautify(plateCvs);
    const plateBlob = await toJpg(plateCvs);
    up(100, 'done');

    return { name, badgeBlob, plateBlob, error: null };
  } catch (e) {
    console.error(name, e);
    up(100, 'err');
    return { name, badgeBlob: null, plateBlob: null, error: e.message };
  }
}

function mkProg(name) {
  const d = document.createElement('div'); d.className = 'progress-item';
  d.innerHTML = `<div class="progress-label"><span>${esc(name)}</span><span><span class="status-icon">⏳</span> <span class="progress-pct">0%</span></span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:0%"></div></div>`;
  E.progL.appendChild(d); return d;
}

// ====== Batch ======
E.proc.onclick = async () => {
  if (S.busy || !S.files.length) return;
  S.busy = true; S.results = [];
  E.progSec.style.display = 'block'; E.resSec.style.display = 'none'; E.zip.style.display = 'none';
  E.progL.innerHTML = ''; upBtn();
  E.proc.textContent = '⏳ 处理中...'; E.proc.disabled = true;
  for (const f of S.files) S.results.push(await procOne(f.file));
  renderR();
  E.resSec.style.display = 'block';
  E.zip.style.display = S.results.some(r => !r.error) ? 'inline-flex' : 'none';
  S.busy = false; upBtn();
};

function renderR() {
  E.resG.innerHTML = S.results.map((r, i) => {
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
  E.resG.querySelectorAll('.dl').forEach(b => b.onclick = () => {
    const r = S.results[+b.dataset.i], t = b.dataset.t;
    download(r[t === 'badge' ? 'badgeBlob' : 'plateBlob'], `${r.name}-${t === 'badge' ? '工牌照' : '座位牌'}.jpg`);
  });
}

// ====== ZIP ======
E.zip.onclick = async () => {
  const ok = S.results.filter(r => !r.error);
  if (!ok.length) return;
  E.zip.textContent = '⏳ 打包中...'; E.zip.disabled = true;
  const zip = new JSZip();
  const bf = zip.folder('工牌照'), pf = zip.folder('座位牌');
  for (const r of ok) { bf.file(`${r.name}-工牌照.jpg`, r.badgeBlob); pf.file(`${r.name}-座位牌.jpg`, r.plateBlob); }
  const blob = await zip.generateAsync({ type: 'blob' });
  const d = new Date();
  download(blob, `员工照片_${d.getFullYear()}${('0'+(d.getMonth()+1)).slice(-2)}${('0'+d.getDate()).slice(-2)}.zip`);
  E.zip.textContent = '📦 下载全部 (ZIP)'; E.zip.disabled = false;
};

function download(blob, name) {
  const u = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(u);
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
