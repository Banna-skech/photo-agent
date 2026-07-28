/**
 * 员工照片批量处理 — 参考0702批次像素级参数
 *
 * 参考数据（6人平均）：1080×1440 画布，人像 56-65%W × 85-89%H
 * 左/右边距 ≈ 200-250px(≈2.5cm)，上边距 ≈ 180px(≈3cm)，下边距 ≈ 2px
 * 144DPI: 1cm ≈ 57px, 2cm ≈ 113px
 */
const CW=1080,CH=1440,JQ=0.94; // 提高 JPEG 质量
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
  try{const m=await import('@imgly/background-removal');rmBg=m.removeBackground||m.default;E.eng.innerHTML='<span class="status-dot ready"></span>AI 就绪';}
  catch(e){E.eng.innerHTML='<span class="status-dot ready" style="background:var(--warning)"></span>AI 不可用';}
  upBtn();
})();
function upBtn(){E.proc.disabled=!S.files.length||S.busy;E.proc.textContent=S.files.length?`🚀 开始处理 (${S.files.length} 张)`:'🚀 开始处理';}

// Files
function addFiles(fs){for(const f of fs){if(!f.type.startsWith('image/')&&!/\.(heic|heif)$/i.test(f.name))continue;if(S.files.some(x=>x.name===f.name))continue;S.files.push({name:f.name,file:f});}if(S.files.length){E.flSec.style.display='block';renderF();}upBtn();}
function rmF(i){S.files.splice(i,1);if(!S.files.length)E.flSec.style.display='none';renderF();upBtn();}
function renderF(){E.fc.textContent=S.files.length+' 张';E.fl.innerHTML=S.files.map((f,i)=>`<div class="file-tag"><span>${esc(f.name)}</span><button class="rm" data-i="${i}">×</button></div>`).join('');E.fl.querySelectorAll('.rm').forEach(b=>b.onclick=e=>{e.stopPropagation();rmF(+b.dataset.i);});}
E.upZone.onclick=()=>E.fInp.click();
E.fInp.onchange=()=>addFiles(E.fInp.files);
E.upZone.ondragover=e=>{e.preventDefault();E.upZone.classList.add('drag-over');};
E.upZone.ondragleave=()=>E.upZone.classList.remove('drag-over');
E.upZone.ondrop=e=>{e.preventDefault();E.upZone.classList.remove('drag-over');addFiles(e.dataTransfer.files);};
$('#clearFiles').onclick=()=>{S.files=[];S.results=[];E.flSec.style.display='none';E.progSec.style.display='none';E.resSec.style.display='none';E.zip.style.display='none';renderF();upBtn();};

// ==== Image utils ====
function loadImg(b){return new Promise((ok,er)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=er;i.src=URL.createObjectURL(b);});}
function toJpg(c){return new Promise(ok=>c.toBlob(ok,'image/jpeg',JQ));}
function imgToCvs(img){const c=document.createElement('canvas');c.width=img.naturalWidth||img.width;c.height=img.naturalHeight||img.height;c.getContext('2d').drawImage(img,0,0);return c;}
function cvsToBlob(cvs,fmt='image/png'){return new Promise(ok=>cvs.toBlob(ok,fmt));}

/**
 * Alpha 遮罩 → 纯白背景
 * Canvas drawImage 预乘 Alpha (RGB_displayed = RGB_true × Alpha/255)
 * 需要 de-pre-multiply 恢复真实色彩，然后用 Alpha 阈值判定背景
 */
function alphaClean(cvs){
  const ctx=cvs.getContext('2d'),w=cvs.width,h=cvs.height;
  const img=ctx.getImageData(0,0,w,h),d=img.data;
  for(let i=0;i<d.length;i+=4){
    const a=d[i+3];
    if(a<200){d[i]=255;d[i+1]=255;d[i+2]=255;d[i+3]=255;}
    else{if(a<255){const f=255/a;d[i]=Math.min(255,Math.round(d[i]*f));d[i+1]=Math.min(255,Math.round(d[i+1]*f));d[i+2]=Math.min(255,Math.round(d[i+2]*f));}d[i+3]=255;}
  }
  ctx.putImageData(img,0,0);
}

/** 孤点清洗 */
function speckClean(cvs,n){
  const ctx=cvs.getContext('2d'),w=cvs.width,h=cvs.height;
  for(let r=0;r<(n||3);r++){
    const img=ctx.getImageData(0,0,w,h),d=img.data,s=w*4;
    function W(o){return d[o]===255&&d[o+1]===255&&d[o+2]===255;}
    let ch=false;
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const ci=y*s+x*4;if(W(ci))continue;if(W(ci-s)&&W(ci+s)&&W(ci-4)&&W(ci+4)){d[ci]=255;d[ci+1]=255;d[ci+2]=255;ch=true;}}
    if(ch)ctx.putImageData(img,0,0);else break;
  }
}

/** 人像边界检测 */
function personBounds(cvs){
  const ctx=cvs.getContext('2d'),w=cvs.width,h=cvs.height;
  const img=ctx.getImageData(0,0,w,h),d=img.data;
  const step=Math.max(3,Math.min(w,h)>>7);
  let L=w,T=h,R=0,B=0;
  for(let y=0;y<h;y+=step)for(let x=0;x<w;x+=step){const i=(y*w+x)*4;if(d[i]<248||d[i+1]<248||d[i+2]<248){if(x<L)L=x;if(y<T)T=y;if(x>R)R=x;if(y>B)B=y;}}
  if(R<=L||B<=T)return{L:0,T:0,pw:w,ph:h};
  return{L,T,pw:R-L+1,ph:B-T+1};
}

/**
 * ★ 合成到 1080×1440 画布
 *
 * bodyCrop: 裁取人像前多少比例（0.55=胸口, 0.75=腰, 0.85=到大腿）
 * marginPx: 四边留白像素（参考 ≈ 180-200px 上边距）
 *
 * 缩放逻辑：让人像宽度填满 (1080-2*margin) 后的剩余空间，
 * 然后按比例缩放。如果高度超出，按高度约束缩放。
 */
function compose(srcCvs, bodyCrop, topMarginPx, lrMarginPx){
  const b=personBounds(srcCvs),pw=b.pw,ph=b.ph;
  const cropH=Math.round(ph*bodyCrop);

  // 可用区域 = 画布减去四边留白
  const availW=CW-2*lrMarginPx;
  const availH=CH-topMarginPx; // 下方尽量贴底（参考中下边距≈2px）

  // 先按宽度适配
  let scale=availW/pw;
  let drawW=Math.round(pw*scale),drawH=Math.round(cropH*scale);

  // 如果高度超出可用区域再收
  if(drawH>availH){scale=availH/cropH;drawW=Math.round(pw*scale);drawH=availH;}

  let drawX=Math.round((CW-drawW)/2);
  let drawY=Math.round(topMarginPx);
  if(drawX<0)drawX=0;
  if(drawY+drawH>CH)drawY=CH-drawH;

  const out=document.createElement('canvas');out.width=CW;out.height=CH;
  const o=out.getContext('2d');
  o.fillStyle='#FFF';o.fillRect(0,0,CW,CH);
  // 使用 imageSmoothingQuality 提高缩放清晰度
  o.imageSmoothingEnabled=true;
  o.imageSmoothingQuality='high';
  o.drawImage(srcCvs,b.L,b.T,pw,cropH,drawX,drawY,drawW,drawH);
  return out;
}

/**
 * 磨皮美白 — 只在最终画布上做，且最小 blur
 * 磨皮强度设为0时完全不模糊
 */
function beautify(cvs){
  const s=parseInt(E.sm.value),b=parseInt(E.br.value);
  if(s<=0&&b<=0)return;
  const w=cvs.width,h=cvs.height;
  if(s>0){
    const r=Math.max(0.5,(s/100)*3); // 最大3px，不是之前的6px
    const bl=document.createElement('canvas');bl.width=w;bl.height=h;
    const bc=bl.getContext('2d');bc.filter=`blur(${r}px)`;
    bc.drawImage(cvs,0,0);bc.filter='none';
    const ctx=cvs.getContext('2d');ctx.globalAlpha=s/100;ctx.drawImage(bl,0,0);ctx.globalAlpha=1;
  }
  if(b>0){const ctx=cvs.getContext('2d');const d=ctx.getImageData(0,0,w,h).data;for(let i=0;i<d.length;i+=4){d[i]=Math.min(255,d[i]*(1+b/150));d[i+1]=Math.min(255,d[i+1]*(1+b/150));d[i+2]=Math.min(255,d[i+2]*(1+b/150));}ctx.putImageData(new ImageData(d,w,h),0,0);}
}

// ==== Process ====
async function procOne(file){
  const name=file.name.replace(/\.(jpg|jpeg|png|heic|heif|webp)$/i,'');
  const pi=mkProg(name);
  const up=(pct,st)=>{const f=pi.querySelector('.progress-bar-fill'),ic=pi.querySelector('.status-icon');f.style.width=pct+'%';if(st==='done'){f.classList.add('done');ic.textContent='✓';}if(st==='err'){f.classList.add('error');ic.textContent='✗';}pi.querySelector('.progress-pct').textContent=pct+'%';};
  try{
    up(5);const img=await loadImg(file);
    up(8);
    // 缩图供 AI（用原图分辨率直接喂AI，不要缩太小导致模糊）
    let sw=img.naturalWidth||img.width,sh=img.naturalHeight||img.height;
    let feedCvs;
    if(Math.max(sw,sh)>1800){const sx=1800/Math.max(sw,sh);feedCvs=document.createElement('canvas');feedCvs.width=Math.round(sw*sx);feedCvs.height=Math.round(sh*sx);feedCvs.getContext('2d').drawImage(img,0,0,feedCvs.width,feedCvs.height);}
    else feedCvs=imgToCvs(img);
    const feedBlob=await cvsToBlob(feedCvs,'image/png');
    up(12);

    // AI 抠图
    let rgbaCvs;
    if(rmBg){try{const r=await rmBg(feedBlob,{model:'medium',output:{format:'image/png'}});const fg=await loadImg(r);rgbaCvs=imgToCvs(fg);}catch(e){console.warn('AI fail:',e.message);}}
    if(!rgbaCvs)rgbaCvs=imgToCvs(img);
    up(35);

    // Alpha 净化 + 孤点
    alphaClean(rgbaCvs);
    speckClean(rgbaCvs,3);
    up(45);

    // 工牌照参数（参考 0702 实际数据）:
    //   bodyCrop=0.85 → 显示全身（头到腰部以下，参考人像占87%高度）
    //   topMargin=180 → ≈3cm 上边距（参考均值186px）
    //   lrMargin=200 → ≈3.5cm 左右边距（参考均值200-250px）
    const badgeCvs=compose(rgbaCvs,0.85,180,200);
    beautify(badgeCvs);
    const badgeBlob=await toJpg(badgeCvs);
    up(72);

    // 座位牌：显示更多身体（0.95），上边距更紧
    const plateCvs=compose(rgbaCvs,0.95,90,180);
    beautify(plateCvs);
    const plateBlob=await toJpg(plateCvs);
    up(100,'done');

    return{name,badgeBlob,plateBlob,error:null};
  }catch(e){console.error(name,e);up(100,'err');return{name,badgeBlob:null,plateBlob:null,error:e.message};}
}

function mkProg(name){const d=document.createElement('div');d.className='progress-item';d.innerHTML=`<div class="progress-label"><span>${esc(name)}</span><span><span class="status-icon">⏳</span> <span class="progress-pct">0%</span></span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:0%"></div></div>`;E.progL.appendChild(d);return d;}

E.proc.onclick=async()=>{if(S.busy||!S.files.length)return;S.busy=true;S.results=[];E.progSec.style.display='block';E.resSec.style.display='none';E.zip.style.display='none';E.progL.innerHTML='';upBtn();E.proc.textContent='⏳ 处理中...';E.proc.disabled=true;for(const f of S.files)S.results.push(await procOne(f.file));renderR();E.resSec.style.display='block';E.zip.style.display=S.results.some(r=>!r.error)?'inline-flex':'none';S.busy=false;upBtn();};

function renderR(){E.resG.innerHTML=S.results.map((r,i)=>{if(r.error)return`<div class="result-card"><div class="card-header">${esc(r.name)} <span style="color:var(--danger)">失败</span></div><div class="card-body"><p style="color:var(--gray-500);font-size:13px">${esc(r.error)}</p></div></div>`;const bu=URL.createObjectURL(r.badgeBlob),pu=URL.createObjectURL(r.plateBlob);return`<div class="result-card"><div class="card-header"><span>${esc(r.name)}</span><span style="color:var(--success);font-size:12px">✓</span></div><div class="card-body"><div class="preview-pair"><div class="preview-item"><img src="${bu}" alt="工牌照" loading="lazy"><div class="label">工牌照</div></div><div class="preview-item"><img src="${pu}" alt="座位牌" loading="lazy"><div class="label">座位牌</div></div></div></div><div class="card-actions"><button class="btn btn-outline btn-sm dl" data-i="${i}" data-t="badge">⬇ 工牌照</button><button class="btn btn-outline btn-sm dl" data-i="${i}" data-t="plate">⬇ 座位牌</button></div></div>`;}).join('');E.resG.querySelectorAll('.dl').forEach(b=>b.onclick=()=>{const r=S.results[+b.dataset.i],t=b.dataset.t;download(r[t==='badge'?'badgeBlob':'plateBlob'],`${r.name}-${t==='badge'?'工牌照':'座位牌'}.jpg`);});}

E.zip.onclick=async()=>{const ok=S.results.filter(r=>!r.error);if(!ok.length)return;E.zip.textContent='⏳ 打包中...';E.zip.disabled=true;const zip=new JSZip();const bf=zip.folder('工牌照'),pf=zip.folder('座位牌');for(const r of ok){bf.file(`${r.name}-工牌照.jpg`,r.badgeBlob);pf.file(`${r.name}-座位牌.jpg`,r.plateBlob);}const blob=await zip.generateAsync({type:'blob'});const d=new Date();download(blob,`员工照片_${d.getFullYear()}${('0'+(d.getMonth()+1)).slice(-2)}${('0'+d.getDate()).slice(-2)}.zip`);E.zip.textContent='📦 下载全部 (ZIP)';E.zip.disabled=false;};

function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(u);}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
