/**
 * 员工照片批量处理（GitHub Pages 纯浏览器版）
 *
 * 构图参数由以下项目参考照片量化校准：
 *   ref_0702_badge、ref_0717_badge、ref_0702_plate、0624座位牌。
 *
 * 工牌照：1080×1440 JPEG / 144 DPI，人物高度约 88%，裁到下腰/胯部。
 * 座位牌：宽700-800×高900 PNG / 144 DPI，排除孤立噪点后按手臂外缘紧凑构图。
 */

const SPEC = Object.freeze({
  dpi: 144,
  badge: {
    width: 1080,
    height: 1440,
    bodyCropRatio: 0.85,
    maxContentWidthPercent: 0.82,
    format: 'image/jpeg',
    extension: 'jpg',
    quality: 0.95,
  },
  plate: {
    height: 900,
    bodyCropRatio: 0.72,
    horizontalMarginPercent: 0.115,
    maxContentWidthPercent: 0.86,
    minWidth: 700,
    maxWidth: 800,
    format: 'image/png',
    extension: 'png',
  },
});

const $ = (selector) => document.querySelector(selector);
const E = {
  upZone: $('#uploadZone'), fInp: $('#fileInput'),
  flSec: $('#fileListSection'), fl: $('#fileList'), fc: $('#fileCount'),
  proc: $('#processBtn'), zip: $('#downloadZipBtn'),
  eng: $('#engineStatus'), progSec: $('#progressSection'), progL: $('#progressList'),
  resSec: $('#resultsSection'), resG: $('#resultsGrid'),
  bTM: $('#badgeTopMargin'), pTM: $('#plateTopMargin'),
  sm: $('#smoothStrength'), br: $('#brightness'),
  bTMv: $('#badgeTopMarginVal'), pTMv: $('#plateTopMarginVal'),
  smv: $('#smoothStrengthVal'), brv: $('#brightnessVal'),
};
const S = { files: [], results: [], busy: false, aiReady: false };
let removeBackground = null;

[
  { e: E.bTM, v: E.bTMv },
  { e: E.pTM, v: E.pTMv },
  { e: E.sm, v: E.smv },
  { e: E.br, v: E.brv },
].forEach(({ e, v }) => {
  e.oninput = () => { v.textContent = `${e.value}%`; };
});

(async () => {
  try {
    const module = await import('@imgly/background-removal');
    removeBackground = module.removeBackground || module.default;
    S.aiReady = typeof removeBackground === 'function';
    if (!S.aiReady) throw new Error('抠图模块未提供可用函数');
    E.eng.innerHTML = '<span class="status-dot ready"></span><span>AI 抠图引擎已就绪</span><span class="status-hint">照片只在当前浏览器中处理</span>';
  } catch (error) {
    console.error('AI 初始化失败:', error);
    S.aiReady = false;
    E.eng.innerHTML = '<span class="status-dot error"></span><span>AI 抠图引擎加载失败，请检查网络后刷新页面</span>';
  }
  updateProcessButton();
})();

function updateProcessButton() {
  E.proc.disabled = !S.files.length || S.busy || !S.aiReady;
  if (S.busy) E.proc.textContent = '⏳ 处理中...';
  else E.proc.textContent = S.files.length ? `🚀 开始处理 (${S.files.length} 张)` : '🚀 开始处理';
}

function addFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) continue;
    if (S.files.some((item) => item.name === file.name && item.file.size === file.size)) continue;
    S.files.push({ name: file.name, file });
  }
  if (S.files.length) {
    E.flSec.style.display = 'block';
    renderFiles();
  }
  updateProcessButton();
}

function removeFile(index) {
  S.files.splice(index, 1);
  if (!S.files.length) E.flSec.style.display = 'none';
  renderFiles();
  updateProcessButton();
}

function renderFiles() {
  E.fc.textContent = `${S.files.length} 张`;
  E.fl.innerHTML = S.files.map((file, index) => (
    `<div class="file-tag"><span>${escapeHtml(file.name)}</span>` +
    `<button class="remove-btn" data-i="${index}" aria-label="移除">×</button></div>`
  )).join('');
  E.fl.querySelectorAll('.remove-btn').forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      removeFile(Number(button.dataset.i));
    };
  });
}

E.upZone.onclick = () => E.fInp.click();
E.fInp.onchange = () => addFiles(E.fInp.files);
E.upZone.ondragover = (event) => {
  event.preventDefault();
  E.upZone.classList.add('drag-over');
};
E.upZone.ondragleave = () => E.upZone.classList.remove('drag-over');
E.upZone.ondrop = (event) => {
  event.preventDefault();
  E.upZone.classList.remove('drag-over');
  addFiles(event.dataTransfer.files);
};
$('#clearFiles').onclick = () => {
  S.files = [];
  S.results = [];
  E.fInp.value = '';
  E.flSec.style.display = 'none';
  E.progSec.style.display = 'none';
  E.resSec.style.display = 'none';
  E.zip.style.display = 'none';
  renderFiles();
  updateProcessButton();
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, width, height);
  return canvas;
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('浏览器无法读取该照片格式'));
    };
    image.src = url;
  });
}

function imageToCanvas(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas;
}

function canvasToBlob(canvas, format = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(`无法导出 ${format} 图片`));
    }, format, quality);
  });
}

/**
 * 把透明抠图合成到精确纯白底。浏览器负责正确的 Alpha 混合，保留发丝
 * 和衣服边缘的柔和过渡，不再使用会切掉发丝的硬阈值。
 */
function flattenToWhite(foregroundCanvas) {
  const output = createCanvas(foregroundCanvas.width, foregroundCanvas.height);
  const context = output.getContext('2d', { alpha: false, willReadFrequently: true });
  context.drawImage(foregroundCanvas, 0, 0);
  return output;
}

function personBounds(canvas, { region = null, alpha = false } = {}) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  const startX = clamp(Math.round(region?.left || 0), 0, width - 1);
  const startY = clamp(Math.round(region?.top || 0), 0, height - 1);
  const endX = clamp(startX + Math.round(region?.width || width), startX + 1, width);
  const endY = clamp(startY + Math.round(region?.height || height), startY + 1, height);
  const step = Math.max(2, Math.floor(Math.min(width, height) / 500));
  const gridWidth = Math.ceil((endX - startX) / step);
  const gridHeight = Math.ceil((endY - startY) / step);
  const cellCount = gridWidth * gridHeight;
  const active = new Uint8Array(cellCount);
  const visited = new Uint8Array(cellCount);
  const queue = new Int32Array(cellCount);

  for (let gy = 0; gy < gridHeight; gy += 1) {
    const y = Math.min(endY - 1, startY + gy * step);
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const x = Math.min(endX - 1, startX + gx * step);
      const offset = (y * width + x) * 4;
      const isContent = alpha
        ? data[offset + 3] > 20
        : data[offset] < 245 || data[offset + 1] < 245 || data[offset + 2] < 245;
      if (isContent) active[gy * gridWidth + gx] = 1;
    }
  }

  let best = null;
  for (let start = 0; start < cellCount; start += 1) {
    if (!active[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let count = 0;
    let minGX = gridWidth;
    let minGY = gridHeight;
    let maxGX = -1;
    let maxGY = -1;
    visited[start] = 1;
    queue[tail++] = start;

    while (head < tail) {
      const cell = queue[head++];
      const gx = cell % gridWidth;
      const gy = Math.floor(cell / gridWidth);
      count += 1;
      minGX = Math.min(minGX, gx);
      minGY = Math.min(minGY, gy);
      maxGX = Math.max(maxGX, gx);
      maxGY = Math.max(maxGY, gy);

      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = gy + dy;
        if (ny < 0 || ny >= gridHeight) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = gx + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= gridWidth) continue;
          const next = ny * gridWidth + nx;
          if (!active[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }

    if (!best || count > best.count) best = { count, minGX, minGY, maxGX, maxGY };
  }

  if (!best) throw new Error('未检测到有效人像，请换一张人物清晰的原图');
  let left = startX + best.minGX * step;
  let top = startY + best.minGY * step;
  let right = Math.min(endX - 1, startX + (best.maxGX + 1) * step - 1);
  let bottom = Math.min(endY - 1, startY + (best.maxGY + 1) * step - 1);
  const padX = alpha ? Math.max(step, Math.round((right - left + 1) * 0.02)) : step;
  const padY = alpha ? Math.max(step, Math.round((bottom - top + 1) * 0.02)) : step;
  left = Math.max(startX, left - padX);
  top = Math.max(startY, top - padY);
  right = Math.min(endX - 1, right + padX);
  bottom = Math.min(endY - 1, bottom + padY);
  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

function drawSubject(source, bounds, cropRatio, canvasWidth, canvasHeight, personWidth, personHeight) {
  const output = createCanvas(canvasWidth, canvasHeight);
  const context = output.getContext('2d', { alpha: false, willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const cropHeight = Math.max(1, Math.min(Math.round(bounds.height * cropRatio), source.height - bounds.top));
  const left = Math.round((canvasWidth - personWidth) / 2);
  const top = canvasHeight - personHeight;
  context.drawImage(
    source,
    bounds.left, bounds.top, bounds.width, cropHeight,
    left, top, personWidth, personHeight,
  );
  return { canvas: output, left, top, cropHeight };
}

function composeBadge(source, bounds) {
  const config = SPEC.badge;
  const topMarginPercent = Number(E.bTM.value) / 100;
  const targetHeight = Math.round(config.height * (1 - topMarginPercent));
  const cropHeight = Math.round(bounds.height * config.bodyCropRatio);
  const heightScale = targetHeight / cropHeight;
  const widthScale = (config.width * config.maxContentWidthPercent) / bounds.width;
  const scale = Math.min(heightScale, widthScale);
  const personWidth = Math.max(1, Math.round(bounds.width * scale));
  const personHeight = Math.max(1, Math.round(cropHeight * scale));
  const result = drawSubject(
    source, bounds, config.bodyCropRatio,
    config.width, config.height, personWidth, personHeight,
  );
  return {
    canvas: result.canvas,
    layout: { width: config.width, height: config.height, personWidth, personHeight, top: result.top },
  };
}

function composePlate(source, bounds, plateBounds) {
  const config = SPEC.plate;
  const topMarginPercent = Number(E.pTM.value) / 100;
  const targetHeight = Math.round(config.height * (1 - topMarginPercent));
  const cropHeight = Math.round(bounds.height * config.bodyCropRatio);
  const heightScale = targetHeight / cropHeight;
  const heightPersonWidth = Math.max(1, Math.round(plateBounds.width * heightScale));
  const idealCanvasWidth = Math.round(heightPersonWidth / (1 - 2 * config.horizontalMarginPercent));
  const canvasWidth = clamp(idealCanvasWidth, config.minWidth, config.maxWidth);
  const widthScale = (canvasWidth * config.maxContentWidthPercent) / plateBounds.width;
  const scale = Math.min(heightScale, widthScale);
  const personWidth = Math.max(1, Math.round(plateBounds.width * scale));
  const personHeight = Math.max(1, Math.round(cropHeight * scale));
  const drawingBounds = {
    left: plateBounds.left,
    top: bounds.top,
    width: plateBounds.width,
    height: bounds.height,
  };
  const result = drawSubject(
    source, drawingBounds, config.bodyCropRatio,
    canvasWidth, config.height, personWidth, personHeight,
  );
  const rightMargin = canvasWidth - result.left - personWidth;
  return {
    canvas: result.canvas,
    layout: {
      width: canvasWidth,
      height: config.height,
      personWidth,
      personHeight,
      left: result.left,
      rightMargin,
      top: result.top,
    },
  };
}

/** 低比例柔化混合，保留五官、Logo 和发丝细节。 */
function beautify(canvas) {
  const smooth = Number(E.sm.value) / 100;
  const brighten = Number(E.br.value) / 100;
  const { width, height } = canvas;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });

  if (smooth > 0) {
    const blurred = createCanvas(width, height);
    const blurContext = blurred.getContext('2d', { alpha: false });
    const radius = Math.max(0.3, smooth * 5);
    blurContext.filter = `blur(${radius}px)`;
    blurContext.drawImage(canvas, 0, 0);
    blurContext.filter = 'none';
    context.save();
    context.globalAlpha = smooth;
    context.drawImage(blurred, 0, 0);
    context.restore();
  }

  if (brighten > 0) {
    const image = context.getImageData(0, 0, width, height);
    const data = image.data;
    for (let index = 0; index < data.length; index += 4) {
      data[index] = Math.min(255, Math.round(data[index] * (1 + brighten)));
      data[index + 1] = Math.min(255, Math.round(data[index + 1] * (1 + brighten)));
      data[index + 2] = Math.min(255, Math.round(data[index + 2] * (1 + brighten)));
      data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[n] = value >>> 0;
  }
  return table;
}
const CRC_TABLE = makeCrcTable();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function uint32(value) {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

function concatBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function pngChunk(type, data = new Uint8Array()) {
  const typeBytes = new TextEncoder().encode(type);
  const body = concatBytes([typeBytes, data]);
  return concatBytes([uint32(data.length), body, uint32(crc32(body))]);
}

async function compressDeflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Encode true RGB PNG (color type 2), with 144 DPI pHYs and no alpha channel. */
async function encodeRgbPng(canvas, dpi) {
  if (typeof CompressionStream !== 'function') {
    const fallback = await canvasToBlob(canvas, 'image/png');
    return setPngDpi(fallback, dpi);
  }

  const { width, height } = canvas;
  const rgba = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const raw = new Uint8Array(height * (1 + width * 3));
  let sourceOffset = 0;
  let outputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[outputOffset++] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[outputOffset++] = rgba[sourceOffset++];
      raw[outputOffset++] = rgba[sourceOffset++];
      raw[outputOffset++] = rgba[sourceOffset++];
      sourceOffset += 1;
    }
  }

  const header = new Uint8Array(13);
  header.set(uint32(width), 0);
  header.set(uint32(height), 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour RGB, no alpha
  const pixelsPerMeter = Math.round(dpi / 0.0254);
  const physical = concatBytes([uint32(pixelsPerMeter), uint32(pixelsPerMeter), new Uint8Array([1])]);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const png = concatBytes([
    signature,
    pngChunk('IHDR', header),
    pngChunk('pHYs', physical),
    pngChunk('IDAT', await compressDeflate(raw)),
    pngChunk('IEND'),
  ]);
  return new Blob([png], { type: 'image/png' });
}

async function setPngDpi(blob, dpi) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pixelsPerMeter = Math.round(dpi / 0.0254);
  const physical = pngChunk('pHYs', concatBytes([
    uint32(pixelsPerMeter), uint32(pixelsPerMeter), new Uint8Array([1]),
  ]));
  const insertAt = 8 + 4 + 4 + 13 + 4; // after PNG signature + IHDR chunk
  return new Blob([bytes.slice(0, insertAt), physical, bytes.slice(insertAt)], { type: 'image/png' });
}

async function encodeJpegWithDpi(canvas, quality, dpi) {
  const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  const original = new Uint8Array(await blob.arrayBuffer());
  const density = clamp(Math.round(dpi), 1, 65535);
  const jfif = new Uint8Array([
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x01,
    (density >>> 8) & 255, density & 255,
    (density >>> 8) & 255, density & 255,
    0x00, 0x00,
  ]);

  // Replace an existing JFIF APP0 block, otherwise add one after SOI.
  if (
    original[2] === 0xff && original[3] === 0xe0 &&
    original[6] === 0x4a && original[7] === 0x46 && original[8] === 0x49 && original[9] === 0x46
  ) {
    const segmentLength = (original[4] << 8) | original[5];
    const segmentEnd = 4 + segmentLength;
    return new Blob([original.slice(0, 2), jfif, original.slice(segmentEnd)], { type: 'image/jpeg' });
  }
  return new Blob([original.slice(0, 2), jfif, original.slice(2)], { type: 'image/jpeg' });
}

function outputName(fileName) {
  return fileName
    .replace(/\.(jpg|jpeg|png|heic|heif|webp)$/i, '')
    .replace(/-原图$/i, '');
}

async function processOne(file) {
  const name = outputName(file.name);
  const progressItem = createProgress(name);
  const update = (percent, status) => {
    const fill = progressItem.querySelector('.progress-bar-fill');
    const icon = progressItem.querySelector('.status-icon');
    fill.style.width = `${percent}%`;
    if (status === 'done') { fill.classList.add('done'); icon.textContent = '✓'; }
    if (status === 'err') { fill.classList.add('error'); icon.textContent = '✗'; }
    progressItem.querySelector('.progress-pct').textContent = `${percent}%`;
  };

  try {
    if (!removeBackground) throw new Error('AI 抠图引擎尚未就绪');
    update(5);
    const originalImage = await loadImage(file);
    update(10);

    let sourceWidth = originalImage.naturalWidth || originalImage.width;
    let sourceHeight = originalImage.naturalHeight || originalImage.height;
    let feedCanvas;
    const maxFeedSide = 2200;
    if (Math.max(sourceWidth, sourceHeight) > maxFeedSide) {
      const scale = maxFeedSide / Math.max(sourceWidth, sourceHeight);
      feedCanvas = document.createElement('canvas');
      feedCanvas.width = Math.round(sourceWidth * scale);
      feedCanvas.height = Math.round(sourceHeight * scale);
      const context = feedCanvas.getContext('2d');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(originalImage, 0, 0, feedCanvas.width, feedCanvas.height);
    } else {
      feedCanvas = imageToCanvas(originalImage);
    }

    const feedBlob = await canvasToBlob(feedCanvas, 'image/png');
    update(16);
    const cutoutBlob = await removeBackground(feedBlob, {
      model: 'medium',
      output: { format: 'image/png' },
    });
    const cutoutImage = await loadImage(cutoutBlob);
    const cutoutCanvas = imageToCanvas(cutoutImage);
    const bounds = personBounds(cutoutCanvas, { alpha: true });
    const plateCropHeight = Math.min(
      Math.round(bounds.height * SPEC.plate.bodyCropRatio),
      cutoutCanvas.height - bounds.top,
    );
    const plateBounds = personBounds(cutoutCanvas, {
      alpha: true,
      region: {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: plateCropHeight,
      },
    });
    const whiteSource = flattenToWhite(cutoutCanvas);
    update(48);

    const badge = composeBadge(whiteSource, bounds);
    beautify(badge.canvas);
    const badgeBlob = await encodeJpegWithDpi(badge.canvas, SPEC.badge.quality, SPEC.dpi);
    const badgeMetadata = inspectJpeg(new Uint8Array(await badgeBlob.arrayBuffer()));
    if (
      badgeMetadata.width !== SPEC.badge.width || badgeMetadata.height !== SPEC.badge.height ||
      badgeMetadata.density?.unit !== 1 || badgeMetadata.density.x !== SPEC.dpi || badgeMetadata.density.y !== SPEC.dpi
    ) {
      throw new Error('工牌照尺寸或 144 DPI 元数据自检失败');
    }
    update(73);

    const plate = composePlate(whiteSource, bounds, plateBounds);
    beautify(plate.canvas);
    const plateBlob = await encodeRgbPng(plate.canvas, SPEC.dpi);
    const plateMetadata = inspectPng(new Uint8Array(await plateBlob.arrayBuffer()));
    const expectedPixelsPerMeter = Math.round(SPEC.dpi / 0.0254);
    if (
      plateMetadata.width !== plate.layout.width || plateMetadata.height !== SPEC.plate.height ||
      plateMetadata.colorType !== 2 || plateMetadata.physical?.unit !== 1 ||
      plateMetadata.physical.x !== expectedPixelsPerMeter || plateMetadata.physical.y !== expectedPixelsPerMeter
      || Math.abs(plate.layout.left - plate.layout.rightMargin) > 1
      || plate.layout.width < SPEC.plate.minWidth || plate.layout.width > SPEC.plate.maxWidth
      || plate.layout.personWidth > Math.round(plate.layout.width * SPEC.plate.maxContentWidthPercent) + 1
    ) {
      throw new Error('座位牌尺寸、RGB 通道或 144 DPI 元数据自检失败');
    }
    update(100, 'done');

    return {
      name,
      badgeBlob,
      plateBlob,
      badgeLayout: badge.layout,
      plateLayout: plate.layout,
      badgeMetadata,
      plateMetadata,
      error: null,
    };
  } catch (error) {
    console.error(name, error);
    update(100, 'err');
    return { name, badgeBlob: null, plateBlob: null, error: error.message };
  }
}

function createProgress(name) {
  const item = document.createElement('div');
  item.className = 'progress-item';
  item.innerHTML = `<div class="progress-label"><span>${escapeHtml(name)}</span>` +
    '<span><span class="status-icon">⏳</span> <span class="progress-pct">0%</span></span></div>' +
    '<div class="progress-bar-bg"><div class="progress-bar-fill" style="width:0%"></div></div>';
  E.progL.appendChild(item);
  return item;
}

E.proc.onclick = async () => {
  if (S.busy || !S.files.length || !S.aiReady) return;
  S.busy = true;
  S.results = [];
  E.progSec.style.display = 'block';
  E.resSec.style.display = 'none';
  E.zip.style.display = 'none';
  E.progL.innerHTML = '';
  updateProcessButton();

  for (const item of S.files) S.results.push(await processOne(item.file));
  renderResults();
  E.resSec.style.display = 'block';
  E.zip.style.display = S.results.some((result) => !result.error) ? 'inline-flex' : 'none';
  S.busy = false;
  updateProcessButton();
};

function renderResults() {
  E.resG.innerHTML = S.results.map((result, index) => {
    if (result.error) {
      return `<div class="result-card"><div class="card-header">${escapeHtml(result.name)}` +
        '<span style="color:var(--danger)">失败</span></div>' +
        `<div class="card-body"><p class="error-message">${escapeHtml(result.error)}</p></div></div>`;
    }
    const badgeUrl = URL.createObjectURL(result.badgeBlob);
    const plateUrl = URL.createObjectURL(result.plateBlob);
    return `<div class="result-card"><div class="card-header"><span>${escapeHtml(result.name)}</span>` +
      '<span style="color:var(--success);font-size:12px">✓</span></div><div class="card-body">' +
      `<div class="preview-pair"><div class="preview-item"><img src="${badgeUrl}" alt="工牌照" loading="lazy">` +
      `<div class="label">工牌照 · ${result.badgeLayout.width}×${result.badgeLayout.height} · 144 DPI</div></div>` +
      `<div class="preview-item"><img src="${plateUrl}" alt="座位牌" loading="lazy">` +
      `<div class="label">座位牌 · ${result.plateLayout.width}×${result.plateLayout.height} · RGB PNG · 144 DPI</div></div></div></div>` +
      `<div class="card-actions"><button class="btn btn-outline btn-sm download" data-i="${index}" data-t="badge">⬇ 工牌照</button>` +
      `<button class="btn btn-outline btn-sm download" data-i="${index}" data-t="plate">⬇ 座位牌</button></div></div>`;
  }).join('');

  E.resG.querySelectorAll('.download').forEach((button) => {
    button.onclick = () => {
      const result = S.results[Number(button.dataset.i)];
      const isBadge = button.dataset.t === 'badge';
      downloadBlob(
        isBadge ? result.badgeBlob : result.plateBlob,
        `${result.name}-${isBadge ? '工牌照.jpg' : '座位牌.png'}`,
      );
    };
  });
}

E.zip.onclick = async () => {
  const successful = S.results.filter((result) => !result.error);
  if (!successful.length) return;
  E.zip.textContent = '⏳ 打包中...';
  E.zip.disabled = true;
  try {
    const zip = new JSZip();
    const badgeFolder = zip.folder('工牌照');
    const plateFolder = zip.folder('座位牌');
    for (const result of successful) {
      badgeFolder.file(`${result.name}-工牌照.jpg`, result.badgeBlob);
      plateFolder.file(`${result.name}-座位牌.png`, result.plateBlob);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const date = new Date();
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    downloadBlob(blob, `员工照片_${stamp}.zip`);
  } finally {
    E.zip.textContent = '📦 下载全部 (ZIP)';
    E.zip.disabled = false;
  }
};

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value) {
  const node = document.createElement('div');
  node.textContent = value;
  return node.innerHTML;
}

// Exposed only for repeatable browser self-checks; it does not contain photos.
function inspectJpeg(bytes) {
  let width = null;
  let height = null;
  let density = null;
  for (let offset = 2; offset + 9 < bytes.length;) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (
      marker === 0xe0 &&
      bytes[offset + 4] === 0x4a && bytes[offset + 5] === 0x46 &&
      bytes[offset + 6] === 0x49 && bytes[offset + 7] === 0x46
    ) {
      density = {
        unit: bytes[offset + 11],
        x: (bytes[offset + 12] << 8) | bytes[offset + 13],
        y: (bytes[offset + 14] << 8) | bytes[offset + 15],
      };
    }
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      width = (bytes[offset + 7] << 8) | bytes[offset + 8];
    }
    offset += 2 + length;
  }
  return { width, height, density };
}

function inspectPng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let physical = null;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type === 'pHYs') {
      physical = {
        x: view.getUint32(offset + 8),
        y: view.getUint32(offset + 12),
        unit: bytes[offset + 16],
      };
    }
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
    physical,
  };
}

window.photoAgentSelfCheck = async () => {
  const outputs = [];
  for (const result of S.results.filter((item) => !item.error)) {
    const badgeBytes = new Uint8Array(await result.badgeBlob.arrayBuffer());
    const plateBytes = new Uint8Array(await result.plateBlob.arrayBuffer());
    outputs.push({
      name: result.name,
      badge: { mime: result.badgeBlob.type, size: result.badgeBlob.size, ...inspectJpeg(badgeBytes) },
      plate: { mime: result.plateBlob.type, size: result.plateBlob.size, ...inspectPng(plateBytes) },
    });
  }
  return {
    dpi: SPEC.dpi,
    badge: { ...SPEC.badge },
    plate: { ...SPEC.plate },
    aiReady: S.aiReady,
    outputs,
  };
};
