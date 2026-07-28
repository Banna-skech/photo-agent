/**
 * 员工照片批量处理 — 纯浏览器版
 *
 * 参数依据：0702/0717 批次 70+ 张参考照片的像素级分析
 * 工牌照: 人像填满 ~87% 高度, 上边距 ~12%, 显示头部到胸口
 * 座位牌: 人像填满 ~93% 高度, 上边距 ~5%,  显示头部到手臂下方
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

// ====== Settings sliders ======
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

// ====== File management ======
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
  if (Math.max(w,h) <= max) {
    const c=document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').drawImage(img,0,0); return c;
  }
  const s = max/Math.max(w,h);
  const c=document.createElement('canvas'); c.width=Math.round(w*s); c.height=Math.round(h*s);
  c.getContext('2d').drawImage(img,0,0,c.width,c.height); return c;
}

// ====== Clean background: kill gray artifacts from AI model ======
function cleanBg(canvas) {
  const ctx = canvas.getContext('2d');
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const out = new Uint8ClampedArray(d.length);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 238 && d[i+1] > 238 && d[i+2] > 238) {
      // near-white → pure white (kills gray specks without touching skin)
      out[i] = 255; out[i+1] = 255; out[i+2] = 255; out[i+3] = 255;
    } else {
      out[i] = d[i]; out[i+1] = d[i+1]; out[i+2] = d[i+2]; out[i+3] = 255;
    }
  }
  ctx.putImageData(new ImageData(out, canvas.width, canvas.height), 0, 0);
}

// ====== Compose: crop person to body portion, scale to fill canvas ======
// bodyPct: what portion of the person to show (0.55=chest, 0.68=below arms)
// topPct:  top margin as % of canvas height
function compose(srcCanvas, bodyPct, topPct) {
  const ctx = srcCanvas.getContext('2d');
  const w = srcCanvas.width, h = srcCanvas.height;
  const step = Math.max(4, Math.min(w, h) >> 7);
  const raw = ctx.getImageData(0, 0, w, h).data;

  // Find person bounds
  let L = w, T = h, R = 0, B = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (raw[i] < 245 || raw[i+1] < 245 || raw[i+2] < 245) {
        if (x < L) L = x; if (y < T) T = y;
        if (x > R) R = x; if (y > B) B = y;
      }
    }
  }
  if (R <= L) { L = 0; T = 0; R = w-1; B = h-1; }
  const pw = R - L + 1;
  const ph = B - T + 1;

  // Crop to top bodyPct of the person height
  const cropH = Math.round(ph * bodyPct);

  // Scale: person fills 87-93% of canvas height
  const targetH = CH * (bodyPct > 0.65 ? 0.93 : 0.87);
  const scale = targetH / cropH;
  const drawW = Math.round(pw * scale);
  const drawH = Math.round(cropH * scale);

  // Position
  let drawX = Math.round((CW - drawW) / 2);
  let drawY = Math.round(CH * topPct / 100);
  if (drawX < 0) drawX = 0;
  if (drawY + drawH > CH) drawY = CH - drawH;
  if (drawY < 0) drawY = 0;

  const out = document.createElement('canvas'); out.width = CW; out.height = CH;
  const octx = out.getContext('2d');
  octx.fillStyle = '#FFF'; octx.fillRect(0, 0, CW, CH);
  octx.drawImage(srcCanvas, L, T, pw, cropH, drawX, drawY, drawW, drawH);

  // Clean background artifacts
  cleanBg(out);
  return out;
}

// ====== Beautify on final 1080x1440 canvas ======
function beautify(cvs) {
  const s = parseInt(E.sm.value), b = parseInt(E.br.value);
  if (s <= 0 && b <= 0) return;
  const w = cvs.width, h = cvs.height;

  // blur layer
  const bl = document.createElement('canvas'); bl.width = w; bl.height = h;
  const bctx = bl.getContext('2d');
  bctx.filter = `blur(${Math.max(1, (s/100)*6)}px)`;
  bctx.drawImage(cvs, 0, 0); bctx.filter = 'none';

  const ctx = cvs.getContext('2d');
  ctx.globalAlpha = s / 100; ctx.drawImage(bl, 0, 0); ctx.globalAlpha = 1;

  if (b > 0) {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.min(255, d[i] * (1 + b/150));
      d[i+1] = Math.min(255, d[i+1] * (1 + b/150));
      d[i+2] = Math.min(255, d[i+2] * (1 + b/150));
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
    up(5); const img = await loadImg(file);

    // Shrink for AI (1080px max → fast)
    up(8); const srcCvs = shrink(img, 1080);

    // AI background removal
    let fgImg = img;
    if (rmBg) {
      up(12);
      const jpg = await toJpg(srcCvs);
      try {
        const r = await rmBg(jpg, { model: 'isnet_quint8', output: { format: 'image/png' } });
        fgImg = await loadImg(r);
      } catch (e) { console.warn('AI fail:', e.message); }
    }

    // Compose onto white background (at AI output resolution)
    up(40);
    const fw = fgImg.naturalWidth || fgImg.width, fh = fgImg.naturalHeight || fgImg.height;
    const bgCvs = document.createElement('canvas'); bgCvs.width = fw; bgCvs.height = fh;
    const bgCtx = bgCvs.getContext('2d');
    bgCtx.fillStyle = '#FFF'; bgCtx.fillRect(0, 0, fw, fh);
    bgCtx.drawImage(fgImg, 0, 0);
    // First-pass background clean on the source
    cleanBg(bgCvs);
    up(50);

    // === Badge: top 55% of body, 12% top margin ===
    const badgeCvs = compose(bgCvs, 0.55, parseFloat(E.bTM.value));
    beautify(badgeCvs);
    const badgeBlob = await toJpg(badgeCvs);
    up(75);

    // === Desk plate: top 68% of body, 5% top margin ===
    const plateCvs = compose(bgCvs, 0.68, parseFloat(E.pTM.value));
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
        <div class="preview-item"><img src="${bu}" alt="工牌照" loading="lazy"><div class="label">工牌照（胸口）</div></div>
        <div class="preview-item"><img src="${pu}" alt="座位牌" loading="lazy"><div class="label">座位牌（手臂下）</div></div>
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
