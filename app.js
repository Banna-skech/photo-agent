/**
 * 员工照片批量处理工具 — 纯浏览器端
 * 无需后端、无需 API 密钥、部署到 GitHub Pages 即可使用
 */

// ============================================================
// 配置
// ============================================================
const CANVAS_W = 1080;
const CANVAS_H = 1440;
const JPEG_QUALITY = 0.95;

// ============================================================
// DOM 引用
// ============================================================
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const uploadZone = $('#uploadZone');
const fileInput = $('#fileInput');
const fileListSection = $('#fileListSection');
const fileList = $('#fileList');
const fileCount = $('#fileCount');
const clearFilesBtn = $('#clearFiles');
const processBtn = $('#processBtn');
const downloadZipBtn = $('#downloadZipBtn');
const engineStatus = $('#engineStatus');
const progressSection = $('#progressSection');
const progressList = $('#progressList');
const resultsSection = $('#resultsSection');
const resultsGrid = $('#resultsGrid');

// Settings
const badgeTopMarginEl = $('#badgeTopMargin');
const plateTopMarginEl = $('#plateTopMargin');
const smoothStrengthEl = $('#smoothStrength');
const brightnessEl = $('#brightness');
const badgeTopMarginVal = $('#badgeTopMarginVal');
const plateTopMarginVal = $('#plateTopMarginVal');
const smoothStrengthVal = $('#smoothStrengthVal');
const brightnessVal = $('#brightnessVal');

// ============================================================
// 状态
// ============================================================
const state = {
  files: [],            // { name, file }
  results: [],          // { name, badgeBlob, plateBlob }
  processing: false,
  engineReady: false,
  engineError: null,
};

// ============================================================
// 设置面板双向绑定
// ============================================================
function bindSlider(el, valEl, suffix = '%') {
  el.addEventListener('input', () => { valEl.textContent = el.value + suffix; });
  valEl.textContent = el.value + suffix;
}
bindSlider(badgeTopMarginEl, badgeTopMarginVal);
bindSlider(plateTopMarginEl, plateTopMarginVal);
bindSlider(smoothStrengthEl, smoothStrengthVal);
bindSlider(brightnessEl, brightnessVal);

// ============================================================
// AI 引擎加载
// ============================================================
let removeBgFn = null;

async function initEngine() {
  try {
    const mod = await import('@imgly/background-removal');
    removeBgFn = mod.removeBackground || mod.default;
    state.engineReady = true;
    engineStatus.innerHTML = `
      <span class="status-dot ready"></span>
      <span>AI 抠图引擎就绪</span>
    `;
  } catch (e) {
    console.warn('AI 引擎加载失败，将使用原图:', e.message);
    state.engineReady = true; // 仍允许处理（无 AI）
    state.engineError = e.message;
    engineStatus.innerHTML = `
      <span class="status-dot ready" style="background:var(--warning)"></span>
      <span>AI 抠图不可用，使用原图处理</span>
      <span class="status-hint">请检查网络，可手动将照片预先换成白底</span>
    `;
  }
  updateProcessBtn();
}

function updateProcessBtn() {
  const ok = state.files.length > 0 && !state.processing;
  processBtn.disabled = !ok;
  processBtn.textContent = state.files.length > 0
    ? `🚀 开始处理 (${state.files.length} 张)`
    : '🚀 开始处理';
}

// ============================================================
// 文件管理
// ============================================================
function addFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/') && !file.name.match(/\.(heic|heif)$/i)) continue;
    if (state.files.find(f => f.name === file.name)) continue; // 去重
    state.files.push({ name: file.name, file });
  }

  if (state.files.length > 0) {
    fileListSection.style.display = 'block';
    renderFileList();
  }
  updateProcessBtn();
}

function removeFile(index) {
  state.files.splice(index, 1);
  if (state.files.length === 0) {
    fileListSection.style.display = 'none';
  }
  renderFileList();
  updateProcessBtn();
}

function clearAllFiles() {
  state.files = [];
  state.results = [];
  fileListSection.style.display = 'none';
  progressSection.style.display = 'none';
  resultsSection.style.display = 'none';
  downloadZipBtn.style.display = 'none';
  renderFileList();
  updateProcessBtn();
}

function renderFileList() {
  fileCount.textContent = state.files.length + ' 张';
  fileList.innerHTML = state.files.map((f, i) => `
    <div class="file-tag">
      <span>${escapeHtml(f.name)}</span>
      <button class="remove-btn" data-index="${i}" title="移除">×</button>
    </div>
  `).join('');

  fileList.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFile(parseInt(btn.dataset.index));
    });
  });
}

// ============================================================
// 上传事件
// ============================================================
uploadZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => addFiles(fileInput.files));

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('drag-over');
});
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  addFiles(e.dataTransfer.files);
});

clearFilesBtn.addEventListener('click', clearAllFiles);

// ============================================================
// 图像处理核心
// ============================================================

/** 从 Blob 创建 Image */
function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = URL.createObjectURL(blob);
  });
}

/** Image → Canvas (保持原始尺寸) */
function imageToCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

/** Canvas → Blob (JPEG) */
function canvasToBlob(canvas, quality = JPEG_QUALITY) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** 检测内容边界（非纯白像素） */
function detectContentBounds(imageData) {
  const { data, width, height } = imageData;
  const THRESHOLD = 245;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 400));

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i] < THRESHOLD || data[i + 1] < THRESHOLD || data[i + 2] < THRESHOLD) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX <= minX || maxY <= minY) {
    return { left: 0, top: 0, width, height };
  }

  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/** 美白磨皮 */
function applyBeautify(sourceCanvas, smoothStrength, brightnessBoost) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  // 0. 保存原图副本（因为后续操作会修改 sourceCanvas）
  const originalCopy = document.createElement('canvas');
  originalCopy.width = w;
  originalCopy.height = h;
  originalCopy.getContext('2d').drawImage(sourceCanvas, 0, 0);

  // 1. 创建磨皮版本：模糊
  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = w;
  blurCanvas.height = h;
  const bctx = blurCanvas.getContext('2d');
  const blurRadius = Math.max(1, Math.round((smoothStrength / 100) * 8));
  bctx.filter = `blur(${blurRadius}px)`;
  bctx.drawImage(originalCopy, 0, 0);
  bctx.filter = 'none';

  // 2. 混合：原图 + 模糊版叠加
  const ctx = sourceCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(originalCopy, 0, 0);
  const blendOpacity = smoothStrength / 100;
  ctx.globalAlpha = blendOpacity;
  ctx.drawImage(blurCanvas, 0, 0);
  ctx.globalAlpha = 1;

  // 3. 美白提亮
  if (brightnessBoost > 0) {
    // 获取当前像素数据
    const imageData = ctx.getImageData(0, 0, w, h);
    const { data } = imageData;
    const boost = brightnessBoost / 100;

    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, data[i] + data[i] * boost * 0.5);
      data[i + 1] = Math.min(255, data[i + 1] + data[i + 1] * boost * 0.5);
      data[i + 2] = Math.min(255, data[i + 2] + data[i + 2] * boost * 0.5);
      // 微降饱和度
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      data[i] = data[i] * 0.92 + gray * 0.08;
      data[i + 1] = data[i + 1] * 0.92 + gray * 0.08;
      data[i + 2] = data[i + 2] * 0.92 + gray * 0.08;
    }
    ctx.putImageData(imageData, 0, 0);
  }
}

/** 调整图片大小（最长边不超过 maxSize） */
function resizeImage(img, maxSize) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (Math.max(w, h) <= maxSize) return imageToCanvas(img);

  const scale = maxSize / Math.max(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** 合成照片到 1080×1440 画布 */
async function composePhoto(sourceCanvas, config) {
  const { topMarginPercent, contentWidthPercent } = config;

  const sctx = sourceCanvas.getContext('2d');
  const srcData = sctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const bounds = detectContentBounds(srcData);

  if (bounds.width < 50 || bounds.height < 50) {
    bounds.left = 0; bounds.top = 0;
    bounds.width = sourceCanvas.width; bounds.height = sourceCanvas.height;
  }

  let scale = (CANVAS_W * contentWidthPercent) / bounds.width;
  let scaledW = Math.round(bounds.width * scale);
  let scaledH = Math.round(bounds.height * scale);
  let left = Math.round((CANVAS_W - scaledW) / 2);
  let top = Math.round(CANVAS_H * topMarginPercent);

  // 高度方向缩放限制：人像不能超出画布
  if (top + scaledH > CANVAS_H) {
    scale = (CANVAS_H - top) / bounds.height;
    scaledW = Math.round(bounds.width * scale);
    scaledH = Math.round(bounds.height * scale);
    left = Math.round((CANVAS_W - scaledW) / 2);
  }
  left = Math.max(0, left);
  top = Math.max(0, top);

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.drawImage(sourceCanvas,
    bounds.left, bounds.top, bounds.width, bounds.height,
    left, top, scaledW, scaledH
  );
  return canvas;
}

// ============================================================
// 处理单张照片
// ============================================================
async function processOne(file, index) {
  const name = file.name.replace(/\.(jpg|jpeg|png|heic|heif|webp)$/i, '');

  // 进度UI
  const progressItem = createProgressItem(name);
  const updateProgress = (pct, status) => {
    const fill = progressItem.querySelector('.progress-bar-fill');
    const icon = progressItem.querySelector('.status-icon');
    fill.style.width = pct + '%';
    if (status === 'done') { fill.classList.add('done'); icon.textContent = '✓'; }
    if (status === 'error') { fill.classList.add('error'); icon.textContent = '✗'; }
    if (status === 'processing') { icon.textContent = '⏳'; }
    progressItem.querySelector('.progress-pct').textContent = pct + '%';
  };

  try {
    // Step 1: 加载图片
    updateProgress(5, 'processing');
    const img = await blobToImage(file);

    // Step 1b: 缩小大图以提高处理速度
    const srcCanvas = resizeImage(img, 2048);
    updateProgress(10, 'processing');

    // Step 2: AI 抠图（在缩小后的图片上运行）
    updateProgress(15, 'processing');
    let personImg;
    if (removeBgFn) {
      const srcBlob = await canvasToBlob(srcCanvas, 1.0);
      try {
        const resultBlob = await removeBgFn(srcBlob, {
          model: 'isnet_quint8',
          output: { format: 'image/png' },
        });
        personImg = await blobToImage(resultBlob);
      } catch (bgErr) {
        console.warn('AI抠图失败，使用原图:', bgErr.message);
        personImg = img;
      }
    } else {
      personImg = img;
    }
    updateProgress(55, 'processing');

    // Step 3: 合成白底（使用原始分辨率）
    const w = personImg.naturalWidth || personImg.width;
    const h = personImg.naturalHeight || personImg.height;
    const whiteBgCanvas = document.createElement('canvas');
    whiteBgCanvas.width = w;
    whiteBgCanvas.height = h;
    const wctx = whiteBgCanvas.getContext('2d');
    wctx.fillStyle = '#FFFFFF';
    wctx.fillRect(0, 0, w, h);
    wctx.drawImage(personImg, 0, 0);
    updateProgress(65, 'processing');

    // Step 4: 美白磨皮
    const smoothStr = parseInt(smoothStrengthEl.value) / 100;
    const brightBoost = parseInt(brightnessEl.value);
    if (smoothStr > 0 || brightBoost > 0) {
      applyBeautify(whiteBgCanvas, parseInt(smoothStrengthEl.value), brightBoost);
    }
    updateProgress(75, 'processing');

    // Step 5: 合成工牌照
    const badgeCanvas = await composePhoto(whiteBgCanvas, {
      topMarginPercent: parseFloat(badgeTopMarginEl.value) / 100,
      contentWidthPercent: 0.60,
    });
    const badgeBlob = await canvasToBlob(badgeCanvas);
    updateProgress(88, 'processing');

    // Step 6: 合成座位牌
    const plateCanvas = await composePhoto(whiteBgCanvas, {
      topMarginPercent: parseFloat(plateTopMarginEl.value) / 100,
      contentWidthPercent: 0.62,
    });
    const plateBlob = await canvasToBlob(plateCanvas);
    updateProgress(100, 'done');

    return {
      name,
      badgeBlob,
      plateBlob,
      error: null,
    };
  } catch (e) {
    console.error(`处理 ${name} 失败:`, e);
    updateProgress(100, 'error');
    return {
      name,
      badgeBlob: null,
      plateBlob: null,
      error: e.message,
    };
  }
}

function createProgressItem(name) {
  const div = document.createElement('div');
  div.className = 'progress-item';
  div.innerHTML = `
    <div class="progress-label">
      <span>${escapeHtml(name)}</span>
      <span><span class="status-icon">⏳</span> <span class="progress-pct">0%</span></span>
    </div>
    <div class="progress-bar-bg">
      <div class="progress-bar-fill" style="width: 0%"></div>
    </div>
  `;
  progressList.appendChild(div);
  return div;
}

// ============================================================
// 批量处理
// ============================================================
processBtn.addEventListener('click', async () => {
  if (state.processing || state.files.length === 0) return;

  state.processing = true;
  state.results = [];
  progressSection.style.display = 'block';
  resultsSection.style.display = 'none';
  downloadZipBtn.style.display = 'none';
  progressList.innerHTML = '';
  updateProcessBtn();
  processBtn.textContent = '⏳ 处理中...';
  processBtn.disabled = true;

  for (let i = 0; i < state.files.length; i++) {
    const result = await processOne(state.files[i].file, i);
    state.results.push(result);
  }

  // 显示结果
  renderResults();
  resultsSection.style.display = 'block';
  downloadZipBtn.style.display = state.results.some(r => !r.error) ? 'inline-flex' : 'none';

  state.processing = false;
  updateProcessBtn();
});

// ============================================================
// 结果渲染
// ============================================================
function renderResults() {
  resultsGrid.innerHTML = state.results.map((r, i) => {
    if (r.error) {
      return `<div class="result-card">
        <div class="card-header">${escapeHtml(r.name)} <span style="color:var(--danger)">失败</span></div>
        <div class="card-body"><p style="color:var(--gray-500);font-size:13px">${escapeHtml(r.error)}</p></div>
      </div>`;
    }

    const badgeUrl = URL.createObjectURL(r.badgeBlob);
    const plateUrl = URL.createObjectURL(r.plateBlob);

    return `<div class="result-card">
      <div class="card-header">
        <span>${escapeHtml(r.name)}</span>
        <span style="color:var(--success);font-size:12px">✓ 完成</span>
      </div>
      <div class="card-body">
        <div class="preview-pair">
          <div class="preview-item">
            <img src="${badgeUrl}" alt="工牌照" loading="lazy">
            <div class="label">工牌照</div>
          </div>
          <div class="preview-item">
            <img src="${plateUrl}" alt="座位牌" loading="lazy">
            <div class="label">座位牌</div>
          </div>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn btn-outline btn-sm download-single" data-index="${i}" data-type="badge">
          ⬇ 工牌照 (JPG)
        </button>
        <button class="btn btn-outline btn-sm download-single" data-index="${i}" data-type="plate">
          ⬇ 座位牌 (JPG)
        </button>
      </div>
    </div>`;
  }).join('');

  // 绑定单张下载
  resultsGrid.querySelectorAll('.download-single').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      const type = btn.dataset.type;
      const result = state.results[idx];
      const blob = type === 'badge' ? result.badgeBlob : result.plateBlob;
      const suffix = type === 'badge' ? '工牌照' : '座位牌';
      downloadBlob(blob, `${result.name}-${suffix}.jpg`);
    });
  });
}

// ============================================================
// ZIP 下载
// ============================================================
downloadZipBtn.addEventListener('click', async () => {
  const successResults = state.results.filter(r => !r.error);
  if (successResults.length === 0) return;

  downloadZipBtn.textContent = '⏳ 打包中...';
  downloadZipBtn.disabled = true;

  const zip = new JSZip();
  const badgeFolder = zip.folder('工牌照');
  const plateFolder = zip.folder('座位牌');

  for (const r of successResults) {
    badgeFolder.file(`${r.name}-工牌照.jpg`, r.badgeBlob);
    plateFolder.file(`${r.name}-座位牌.jpg`, r.plateBlob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  downloadBlob(zipBlob, `员工照片_${dateStr}.zip`);

  downloadZipBtn.textContent = '📦 下载全部 (ZIP)';
  downloadZipBtn.disabled = false;
});

// ============================================================
// 工具函数
// ============================================================
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// 启动
// ============================================================
initEngine();
updateProcessBtn();
