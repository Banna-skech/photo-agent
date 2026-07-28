/**
 * 员工照片批量处理 — 纯浏览器版
 *
 * 参考 0702/0717 批次 70+ 张照片的像素分析：
 *   工牌照: 人像填满 ~87% 高度，上边距 ~12%
 *   座位牌: 人像填满 ~90% 高度，上边距 ~6%
 */
const CW=1080, CH=1440, JQ=0.92;
const $=s=>document.querySelector(s);
const E={
  upZone:$('#uploadZone'),fInp:$('#fileInput'),
  flSec:$('#fileListSection'),fl:$('#fileList'),fc:$('#fileCount'),
  proc:$('#processBtn'),zip:$('#downloadZipBtn'),
  eng:$('#engineStatus'),progSec:$('#progressSection'),progL:$('#progressList'),
  resSec:$('#resultsSection'),resG:$('#resultsGrid'),
  bTM:$('#badgeTopMargin'),pTM:$('#plateTopMargin'),
  sm:$('#smoothStrength'),br:$('#brightness'),
  bTMv:$('#badgeTopMarginVal'),pTMv:$('#plateTopMarginVal'),
  smv:$('#smoothStrengthVal'),brv:$('#brightnessVal'),
};
const S={files:[],results:[],busy:false};
let rmBg=null;
[{e:E.bTM,v:E.bTMv},{e:E.pTM,v:E.pTMv},{e:E.sm,v:E.smv},{e:E.br,v:E.brv}]
  .forEach(x=>{x.e.oninput=()=>x.v.textContent=x.e.value+'%';});
(async()=>{
  try{const m=await import('@imgly/background-removal');rmBg=m.removeBackground||m.default;E.eng.innerHTML='<span class="status-dot ready"></span>AI 抠图就绪';}
  catch(e){E.eng.innerHTML='<span class="status-dot ready" style="background:var(--warning)"></span>AI 不可用';}
  upBtn();
})();
function upBtn(){E.proc.disabled=!S.files.length||S.busy;E.proc.textContent=S.files.length?`🚀 开始处理 (${S.files.length} 张)`:'🚀 开始处理';}

// ==== Files ====
function addFiles(fs){for(const f of fs){if(!f.type.startsWith('image/')&&!/\.(heic|heif)$/i.test(f.name))continue;if(S.files.some(x=>x.name===f.name))continue;S.files.push({name:f.name,file:f});}if(S.files.length){E.flSec.style.display='block';renderF();}upBtn();}
function rmF(i){S.files.splice(i,1);if(!S.files.length)E.flSec.style.display='none';renderF();upBtn();}
function renderF(){E.fc.textContent=S.files.length+' 张';E.fl.innerHTML=S.files.map((f,i)=>`<div class="file-tag"><span>${esc(f.name)}</span><button class="rm" data-i="${i}">×</button></div>`).join('');E.fl.querySelectorAll('.rm').forEach(b=>b.onclick=e=>{e.stopPropagation();rmF(+b.dataset.i);});}
E.upZone.onclick=()=>E.fInp.click();
E.fInp.onchange=()=>addFiles(E.fInp.files);
E.upZone.ondragover=e=>{e.preventDefault();E.upZone.classList.add('drag-over');};
E.upZone.ondragleave=()=>E.upZone.classList.remove('drag-over');
E.upZone.ondrop=e=>{e.preventDefault();E.upZone.classList.remove('drag-over');addFiles(e.dataTransfer.files);};
$('#clearFiles').onclick=()=>{S.files=[];S.results=[];E.flSec.style.display='none';E.progSec.style.display='none';E.resSec.style.display='none';E.zip.style.display='none';renderF();upBtn();};

// ==== Utils ====
function loadImg(b){return new Promise((ok,er)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=er;i.src=URL.createObjectURL(b);});}
function toJpg(c){return new Promise(ok=>c.toBlob(ok,'image/jpeg',JQ));}

/**
 * 绘制 RGBA Image 到 canvas（Alpha 通道在 canvas 中被预乘）
 * 返回 {canvas, width, height}
 */
function rgbaImageToCanvas(img) {
  const c=document.createElement('canvas');
  c.width=img.naturalWidth||img.width;
  c.height=img.naturalHeight||img.height;
  c.getContext('2d').drawImage(img,0,0);
  return c;
}

/**
 * ★ 关键：基于 Alpha 通道构建纯白底人像
 *
 * AI 模型输出透明 PNG，但 canvas drawImage 会把 RGB 预乘 Alpha。
 * 解法：
 *   1. 读 ImageData（含预乘 RGB + Alpha）
 *   2. De-pre-multiply 恢复真实 RGB
 *   3. Alpha < 阈值 → 涂白（这是背景）
 *   4. Alpha ≥ 阈值 → 保留真实 RGB
 *
 * 与之前方案的区别：不再做复杂的形态学/中值滤波，直接信任模型 Alpha。
 * 只要阈值合适（150-200），灰点全部消除。
 */
function buildCleanWhiteBg(rgbaCanvas) {
  const ctx=rgbaCanvas.getContext('2d');
  const w=rgbaCanvas.width, h=rgbaCanvas.height;
  const img=ctx.getImageData(0,0,w,h);
  const d=img.data;
  const THRESH = 180; // Alpha 低于此值判定为背景

  for (let i=0; i<d.length; i+=4) {
    const a=d[i+3];
    if (a < THRESH) {
      // 背景 → 纯白
      d[i]=255; d[i+1]=255; d[i+2]=255; d[i+3]=255;
    } else {
      // 前景 → de-pre-multiply 恢复原色
      if (a > 0 && a < 255) {
        const factor = 255 / a;
        d[i] = Math.min(255, Math.round(d[i] * factor));
        d[i+1] = Math.min(255, Math.round(d[i+1] * factor));
        d[i+2] = Math.min(255, Math.round(d[i+2] * factor));
      }
      d[i+3]=255;
    }
  }
  ctx.putImageData(img,0,0);
  return rgbaCanvas;
}

/**
 * RGB 二次净化：扫描非纯白像素，如果它周围 3×3 都是纯白 → 孤立噪点 → 涂白
 */
function removeIsolatedSpecks(canvas) {
  const ctx=canvas.getContext('2d');
  const w=canvas.width, h=canvas.height;
  const img=ctx.getImageData(0,0,w,h);
  const d=img.data;
  const stride=w*4;
  let modified=false;

  for (let y=1; y<h-1; y++) {
    for (let x=1; x<w-1; x++) {
      const ci=y*stride+x*4;
      if (d[ci]===255&&d[ci+1]===255&&d[ci+2]===255) continue; // already white

      // 检查 3×3 邻域是否全是纯白
      let allWhite=true;
      for (let dy=-1; dy<=1&&allWhite; dy++) {
        for (let dx=-1; dx<=1&&allWhite; dx++) {
          if (dx===0&&dy===0) continue;
          const ni=(y+dy)*stride+(x+dx)*4;
          if (d[ni]!==255||d[ni+1]!==255||d[ni+2]!==255) allWhite=false;
        }
      }
      if (allWhite) {
        d[ci]=255; d[ci+1]=255; d[ci+2]=255;
        modified=true;
      }
    }
  }

  if (modified) ctx.putImageData(img,0,0);
}

/**
 * ★ 检测人像边界（在干净白底上跑，结果精确）
 * 返回 { left, top, right, bottom, width, height }
 */
function getPersonBounds(canvas) {
  const ctx=canvas.getContext('2d');
  const w=canvas.width, h=canvas.height;
  const img=ctx.getImageData(0,0,w,h);
  const d=img.data;
  const step=Math.max(3, Math.min(w,h)>>7);
  let L=w,T=h,R=0,B=0;
  for (let y=0; y<h; y+=step) {
    for (let x=0; x<w; x+=step) {
      const i=(y*w+x)*4;
      if (d[i]<248||d[i+1]<248||d[i+2]<248) {
        if (x<L) L=x; if (y<T) T=y;
        if (x>R) R=x; if (y>B) B=y;
      }
    }
  }
  if (R<=L||B<=T) return {L:0,T:0,R:w-1,B:h-1,w,h,
    pw:w,ph:h, left:0,top:0,right:w-1,bottom:h-1,width:w,height:h};
  return {L,T,R,B,w,h, pw:R-L+1,ph:B-T+1,
    left:L,top:T,right:R,bottom:B,width:R-L+1,height:B-T+1};
}

/**
 * ★ 合成照片到 1080×1440 画布
 *
 * @param srcCanvas - 干净白底人像
 * @param bodyCropPct - 裁取人像的前百分之几（0.55=到胸口，0.68=到手臂下）
 * @param topMarginPct - 顶部留白百分比
 *
 * 核心改变：先裁身体比例 → 按高度缩放填满目标 → 居中
 */
function compose(srcCanvas, bodyCropPct, topMarginPct) {
  const bounds = getPersonBounds(srcCanvas);
  const pw=bounds.width, ph=bounds.height;

  // 裁取身体上部 bodyCropPct
  const cropH=Math.round(ph * bodyCropPct);

  // ★ 按高度缩放：让人像裁剪后的部分填满目标高度的 87-93%
  const targetFillH = bodyCropPct > 0.60 ? 0.90 : 0.87;
  const targetH = CH * targetFillH;
  const scale = targetH / cropH;
  const drawW = Math.round(pw * scale);
  const drawH = Math.round(cropH * scale);

  // 水平居中，顶部按 margin
  let drawX = Math.round((CW - drawW) / 2);
  let drawY = Math.round(CH * topMarginPct / 100);
  if (drawX < 0) drawX = 0;
  if (drawY + drawH > CH) drawY = CH - drawH;
  if (drawY < 0) drawY = 0;

  const out = document.createElement('canvas'); out.width=CW; out.height=CH;
  const octx = out.getContext('2d');
  octx.fillStyle = '#FFF'; octx.fillRect(0, 0, CW, CH);
  octx.drawImage(srcCanvas, bounds.L, bounds.T, pw, cropH, drawX, drawY, drawW, drawH);
  return out;
}

// ==== 美白磨皮 (on 1080×1440) ====
function beautify(cvs) {
  const s=parseInt(E.sm.value), b=parseInt(E.br.value);
  if(s<=0&&b<=0) return;
  const w=cvs.width,h=cvs.height;
  const bl=document.createElement('canvas');bl.width=w;bl.height=h;
  const bctx=bl.getContext('2d');
  bctx.filter=`blur(${Math.max(1,(s/100)*6)}px)`;
  bctx.drawImage(cvs,0,0);bctx.filter='none';
  const ctx=cvs.getContext('2d');
  ctx.globalAlpha=s/100;ctx.drawImage(bl,0,0);ctx.globalAlpha=1;
  if(b>0){const d=ctx.getImageData(0,0,w,h).data;for(let i=0;i<d.length;i+=4){d[i]=Math.min(255,d[i]*(1+b/150));d[i+1]=Math.min(255,d[i+1]*(1+b/150));d[i+2]=Math.min(255,d[i+2]*(1+b/150));}ctx.putImageData(new ImageData(d,w,h),0,0);}
}

// ==== Process one ====
async function procOne(file) {
  const name=file.name.replace(/\.(jpg|jpeg|png|heic|heif|webp)$/i,'');
  const pi=mkProg(name);
  const up=(pct,st)=>{
    const f=pi.querySelector('.progress-bar-fill'),ic=pi.querySelector('.status-icon');
    f.style.width=pct+'%';
    if(st==='done'){f.classList.add('done');ic.textContent='✓';}
    if(st==='err'){f.classList.add('error');ic.textContent='✗';}
    pi.querySelector('.progress-pct').textContent=pct+'%';
  };

  try {
    up(5);
    const img=await loadImg(file);
    up(8);

    // 缩小原图用于 AI（1080px）
    let srcW=img.naturalWidth||img.width, srcH=img.naturalHeight||img.height;
    let inputImg=img;
    if (Math.max(srcW,srcH)>1080) {
      const s=1080/Math.max(srcW,srcH);
      const c=document.createElement('canvas');
      c.width=Math.round(srcW*s);c.height=Math.round(srcH*s);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      srcW=c.width;srcH=c.height;
      // convert to blob for AI
      inputImg=await new Promise(ok=>c.toBlob(ok,'image/jpeg',0.95));
      inputImg=await loadImg(inputImg);
    }

    // AI 抠图 → RGBA PNG
    up(12);
    let rgbaCvs;
    if (rmBg) {
      try {
        // Feed JPEG blob to AI
        const jpgBlob = await new Promise(ok => {
          const tmp=document.createElement('canvas');
          tmp.width=srcW; tmp.height=srcH;
          tmp.getContext('2d').drawImage(inputImg,0,0);
          tmp.toBlob(ok,'image/jpeg',0.95);
        });
        const r = await rmBg(jpgBlob, {model:'isnet_quint8',output:{format:'image/png'}});
        const fgImg = await loadImg(r);
        rgbaCvs = rgbaImageToCanvas(fgImg);
      } catch(e) { console.warn('AI fail:',e.message); }
    }
    // Fallback: use original image (already white bg or not)
    if (!rgbaCvs) {
      rgbaCvs = rgbaImageToCanvas(img);
      // Fill with white to be safe (if no AI, may have original bg)
    }
    up(30);

    // ★ 关键步骤：Alpha-mask 构建纯净白底
    buildCleanWhiteBg(rgbaCvs);
    up(35);

    // ★ 二次净化：孤立噪点消除
    removeIsolatedSpecks(rgbaCvs);
    up(40);

    // ★ 工牌照：身体上55%，填满87%高度，上边距12%
    const badgeCvs = compose(rgbaCvs, 0.55, parseFloat(E.bTM.value));
    beautify(badgeCvs);
    const badgeBlob = await toJpg(badgeCvs);
    up(70);

    // ★ 座位牌：身体上68%，填满90%高度，上边距6%
    // 68%大致到手肘下方 = 比工牌照多显示 ~24% 身体
    const plateCvs = compose(rgbaCvs, 0.68, parseFloat(E.pTM.value));
    beautify(plateCvs);
    const plateBlob = await toJpg(plateCvs);
    up(100,'done');

    return {name,badgeBlob,plateBlob,error:null};
  } catch(e) {console.error(name,e);up(100,'err');return{name,badgeBlob:null,plateBlob:null,error:e.message};}
}

function mkProg(name){const d=document.createElement('div');d.className='progress-item';d.innerHTML=`<div class="progress-label"><span>${esc(name)}</span><span><span class="status-icon">⏳</span> <span class="progress-pct">0%</span></span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:0%"></div></div>`;E.progL.appendChild(d);return d;}

E.proc.onclick=async()=>{if(S.busy||!S.files.length)return;S.busy=true;S.results=[];E.progSec.style.display='block';E.resSec.style.display='none';E.zip.style.display='none';E.progL.innerHTML='';upBtn();E.proc.textContent='⏳ 处理中...';E.proc.disabled=true;for(const f of S.files)S.results.push(await procOne(f.file));renderR();E.resSec.style.display='block';E.zip.style.display=S.results.some(r=>!r.error)?'inline-flex':'none';S.busy=false;upBtn();};

function renderR(){E.resG.innerHTML=S.results.map((r,i)=>{if(r.error)return`<div class="result-card"><div class="card-header">${esc(r.name)} <span style="color:var(--danger)">失败</span></div><div class="card-body"><p style="color:var(--gray-500);font-size:13px">${esc(r.error)}</p></div></div>`;const bu=URL.createObjectURL(r.badgeBlob),pu=URL.createObjectURL(r.plateBlob);return`<div class="result-card"><div class="card-header"><span>${esc(r.name)}</span><span style="color:var(--success);font-size:12px">✓</span></div><div class="card-body"><div class="preview-pair"><div class="preview-item"><img src="${bu}" alt="工牌照" loading="lazy"><div class="label">工牌照（胸口）</div></div><div class="preview-item"><img src="${pu}" alt="座位牌" loading="lazy"><div class="label">座位牌（手臂下）</div></div></div></div><div class="card-actions"><button class="btn btn-outline btn-sm dl" data-i="${i}" data-t="badge">⬇ 工牌照</button><button class="btn btn-outline btn-sm dl" data-i="${i}" data-t="plate">⬇ 座位牌</button></div></div>`;}).join('');E.resG.querySelectorAll('.dl').forEach(b=>b.onclick=()=>{const r=S.results[+b.dataset.i],t=b.dataset.t;download(r[t==='badge'?'badgeBlob':'plateBlob'],`${r.name}-${t==='badge'?'工牌照':'座位牌'}.jpg`);});}

E.zip.onclick=async()=>{const ok=S.results.filter(r=>!r.error);if(!ok.length)return;E.zip.textContent='⏳ 打包中...';E.zip.disabled=true;const zip=new JSZip();const bf=zip.folder('工牌照'),pf=zip.folder('座位牌');for(const r of ok){bf.file(`${r.name}-工牌照.jpg`,r.badgeBlob);pf.file(`${r.name}-座位牌.jpg`,r.plateBlob);}const blob=await zip.generateAsync({type:'blob'});const d=new Date();download(blob,`员工照片_${d.getFullYear()}${('0'+(d.getMonth()+1)).slice(-2)}${('0'+d.getDate()).slice(-2)}.zip`);E.zip.textContent='📦 下载全部 (ZIP)';E.zip.disabled=false;};

function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(u);}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
