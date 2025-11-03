// ============ 基础 DOM ============
const cvs = document.getElementById('stage');
const ctx = cvs.getContext('2d');
const modalStart = document.getElementById('modalStart');
const modalTrial = document.getElementById('modalTrial');
const modalPost1 = document.getElementById('modalPost1');
const modalPost2 = document.getElementById('modalPost2');
const btnStart = document.getElementById('btnStart');
const btnSubmitTrial = document.getElementById('btnSubmitTrial');
const btnPost1Next = document.getElementById('btnPost1Next');
const btnPostSubmit = document.getElementById('btnPostSubmit');

// 试次级数据
const trialRows = [];
let postSurvey = null;

// ============ 实验参数 ============
const W = 1200, H = 720;
const scalePxPerM = 12;
const specCN = { laneWidthM: 3.5, lanes: 4, sidewalkWidthM: 3.5 };
const road = { x: 0, width: 0, color: '#8e9ba8', laneMark: '#ffffff' };
const crosswalk = { y: 0, height: 60, barWidth: 20, gap: 16 };
const goal = { x: 980, y: 260, w: 160, h: 150, label: '目的地' };

let destImg = null;
let destImgReady = false;

function drawLight(x, y, lit) {
  const w = 28, h = 76;
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#364151';
  ctx.fillRect(x + w/2 - 2, y + h, 4, 28);
  circleFill(x + w/2, y + 18, 10, lit==='red' ? '#ef4444' : '#552222', lit==='red');
  circleFill(x + w/2, y + h - 18, 10, lit==='green' ? '#22c55e' : '#0c4022', lit==='green');
}

function kmhToPps(kmh){ return kmh * 1000 / 3600 * scalePxPerM; }

function circleFill(cx, cy, r, color, glow=false){
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
  ctx.fillStyle=color; ctx.fill();
  if (glow){
    ctx.save(); ctx.globalAlpha=0.5; ctx.strokeStyle=color; ctx.lineWidth=12;
    ctx.beginPath(); ctx.arc(cx,cy,r+3,0,Math.PI*2); ctx.stroke(); ctx.restore();
  }
}

// ============ 场景几何 ============
let sidewalkLeft, sidewalkRight, zoneCross, zoneDirect, lightPos;
(function applyGeometry(){
  const url = new URLSearchParams(location.search);
  const userOffset = parseInt(url.get('offsetPx') || '0', 10) || 0;

  const lane = specCN.laneWidthM, lanes = specCN.lanes;
  road.width = Math.round(lane * lanes * scalePxPerM);
  road.x = Math.round((W - road.width)/2);

  const baseSidewalkTop = Math.round(H * 0.75);
  const lightBoxH = 76;
  const crosswalkGap = 10;
  const lightOffsetBelowSidewalk = 12;

  const tempSidewalkTop = baseSidewalkTop;
  const tempLightY = tempSidewalkTop + lightOffsetBelowSidewalk;
  const maxOffset = H - (tempLightY + lightBoxH);

  const offset = Math.max(0, Math.min(userOffset, maxOffset));
  const sidewalkTop = baseSidewalkTop + offset;

  sidewalkLeft = { x: 0, y: sidewalkTop, w: road.x, h: H - sidewalkTop };
  sidewalkRight = { x: road.x + road.width, y: sidewalkTop, w: W - (road.x+road.width), h: H - sidewalkTop };

  crosswalk.y = sidewalkTop - crosswalk.height - crosswalkGap;
  crosswalk.y += 40;

  lightPos = { x: road.x - 48, y: sidewalkTop + lightOffsetBelowSidewalk + 30};

  zoneCross = { x: road.x, y: crosswalk.y - 10, w: road.width, h: crosswalk.height + 20 };
  const midY = Math.round(H/2);
  zoneDirect = { x: road.x, y: midY - 80, w: road.width, h: 160 };

  goal.x = sidewalkRight.x + 100;
  goal.y = Math.max(12, crosswalk.y - goal.h - 90);

  if (goal.y + goal.h >= sidewalkRight.y - 6) {
    goal.y = sidewalkRight.y - goal.h - 6;
  }
})();

// ============ 实体 ============
const PLAYER = { r: 10, speed: 4.3 * scalePxPerM, color:'#67e8f9', stroke:'#0ea5b7' };
const PEER = { r: PLAYER.r, minV:110, maxV:170, color:'#fbbf24', stroke:'#8b5cf6' };
const CAR = {
  w: 42, h: 72,
  slow: kmhToPps(20),
  fast: kmhToPps(35),
  color:'#ef4444'
};

function defaultPositions(peersN){
  const startY = Math.round(H/2);
  const startX = Math.max(PLAYER.r + 2, road.x - 6 - PLAYER.r);
  const player = { x:startX - 25, y:startY, r:PLAYER.r, speed:PLAYER.speed, path:null, wp:0, moving:false };

  let peers = [];
  if (peersN > 0){
    const baseX = road.x - 6 - PLAYER.r;
    const yMid = Math.round(H/2);
    peers = [
      { x: baseX -20, y: yMid + 20, r: PLAYER.r, speed: 4.2 * scalePxPerM, hidden:false, laneOffset:-12 },
      { x: baseX -0, y: yMid + 30, r: PLAYER.r, speed: 4.4* scalePxPerM, hidden:false, laneOffset: 0 },
      { x: baseX -16, y: yMid + 40, r: PLAYER.r, speed: 4.3 * scalePxPerM, hidden:false, laneOffset: 12 }
    ];
    peers = peers.slice(0, Math.min(peersN, 3));
  }
  return { player, peers };
}

// ============ Trials 配置 ============
const CAR_RISK = ['NoCar','LowSpeed','HighSpeed'];
const SIGNAL = ['RedLight','GreenLight'];
const WAIT_RED = [10,30];

// ============ Trials 配置（按 A/B/C 三组手工表）===========

// 映射表：把你表格里的缩写转成现有代码使用的枚举值
const MAP = {
  Car:   { NC: 'NoCar',   LS: 'LowSpeed', HS: 'HighSpeed' },
  Sig:   { Red: 'RedLight', Green: 'GreenLight' },
  Norm:  { NP: 'NoPed',  WP: 'Crosswalk', CP: 'Crossing' }
};

// 三组各 6 个 trial（A=车辆，B=信号，D=规范）
const GROUPS = {
  1: [ // Group A
    { A: 'NC', B: 'Red',   D: 'NP' },
    { A: 'LS', B: 'Red',   D: 'WP' },
    { A: 'HS', B: 'Red',   D: 'CP' },
    { A: 'NC', B: 'Green', D: 'CP' },
    { A: 'LS', B: 'Green', D: 'NP' },
    { A: 'HS', B: 'Green', D: 'WP' },
  ],
  2: [ // Group B
    { A: 'NC', B: 'Red',   D: 'WP' },
    { A: 'LS', B: 'Red',   D: 'CP' },
    { A: 'HS', B: 'Red',   D: 'NP' },
    { A: 'NC', B: 'Green', D: 'NP' },
    { A: 'LS', B: 'Green', D: 'WP' },
    { A: 'HS', B: 'Green', D: 'CP' },
  ],
  3: [ // Group C
    { A: 'NC', B: 'Red',   D: 'CP' },
    { A: 'LS', B: 'Red',   D: 'NP' },
    { A: 'HS', B: 'Red',   D: 'WP' },
    { A: 'NC', B: 'Green', D: 'WP' },
    { A: 'LS', B: 'Green', D: 'CP' },
    { A: 'HS', B: 'Green', D: 'NP' },
  ]
};

// 返回指定组的 trials 数组（保持 Wait_Cost 字段以兼容原代码）
function trialsForGroup(groupId){
  const rows = GROUPS[groupId] || GROUPS[1];
  return rows.map(r => ({
    Car_Risk:     MAP.Car[r.A],
    Signal_State: MAP.Sig[r.B],
    Social_Norm:  MAP.Norm[r.D],
    // 为了最小改动，保留字段但不生效；若以后用等待操控，再改这里
    Wait_Cost: 60
  }));
}


function circleRectHit(cx, cy, cr, rx, ry, rw, rh){
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  return (dx*dx + dy*dy) <= cr*cr;
}

function checkCollisionAndEnd(){
  if (state.phase === 'feedback' || state.phase === 'question') return false;
  if (!state || !state.player || !state.car) return;
  const hit = circleRectHit(
    state.player.x, state.player.y, state.player.r,
    state.car.x, state.car.y, state.car.w, state.car.h
  );
  if (hit){
    state.collision = 1;
    state.phase = 'feedback';
    state.player.moving = false;
    setTimeout(()=>{ openQuestionnaire(); }, 500);
    return;
  }
  return false;
}

// ============ 状态与数据 ============
const participantId = Date.now().toString(36) + Math.random().toString(36).slice(2);
const groupId = (Math.floor(Math.random()*3)+1);

// 从 URL 读取配置
const urlParams = new URLSearchParams(window.location.search);
let trials = trialsForGroup(groupId);
const DEV_USE_MANUAL = false;
// ✅ 手动定义实验场景集合
// 每个对象代表一个 trial 的配置
const manualTrials = [
  { Car_Risk: 'NoCar', Signal_State: 'GreenLight', Wait_Cost: 60, Social_Norm: 'NoPed' },
  { Car_Risk: 'LowSpeed', Signal_State: 'RedLight', Wait_Cost: 30, Social_Norm: 'Crosswalk' },
  { Car_Risk: 'HighSpeed', Signal_State: 'GreenLight', Wait_Cost: 60, Social_Norm: 'Crossing' }
];

// ✅ 若想使用手工集合，则直接替换：
if (DEV_USE_MANUAL) {
trials = manualTrials.slice();
}
// ✅ 集合长度即试次数量
console.log("Loaded manual trial set:", trials.length, "trials");

// 设置试次数量
const numTrials = parseInt(urlParams.get('trials')) || trials.length;
if (numTrials !== trials.length) {
  trials = trials.slice(0, Math.min(numTrials, trials.length));
}

// 手动配置单个场景
if (urlParams.get('manual') === '1') {
  // ✅ 最后一步：组内随机顺序（确保不会被后续代码覆盖）


  const car = urlParams.get('car') || 'NoCar';
  const signal = urlParams.get('signal') || 'GreenLight';
  const social = urlParams.get('social') || 'NoPed';
  
  trials = [{
    Car_Risk: car,
    Signal_State: signal,
    Social_Norm: social
  }];
  
  console.log('[手动配置模式]', trials[0]);
}
trials = shuffle(trials);
console.log('[随机后顺序]', trials.map(t => `${t.Car_Risk}-${t.Signal_State}-${t.Social_Norm}`));
let tIndex = 0;

let state = {
  phase: 'idle',
  preloadStart: 0,
  presentStart: 0,
  rtStart: 0,
  decisionTime: null,
  choice: null,
  collision: 0,
  player: null,
  peers: [],
  car: null,
  light: 'green',
  waitCounter: null,
  readyForNext: false
};

// ============ 工具 ============
function rand(a,b){ return a + Math.random()*(b-a); }
function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
function shuffle(a){
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============ 绘制 ============
function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = '#d7e0ea'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle = '#d7e0ea';
  ctx.fillRect(sidewalkLeft.x, sidewalkLeft.y, sidewalkLeft.w, sidewalkLeft.h);
  ctx.fillRect(sidewalkRight.x, sidewalkRight.y, sidewalkRight.w, sidewalkRight.h);
  ctx.fillStyle = road.color; ctx.fillRect(road.x,0,road.width,H);
  ctx.strokeStyle = road.laneMark; ctx.setLineDash([14,18]); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(road.x+road.width/2,0); ctx.lineTo(road.x+road.width/2,H); ctx.stroke(); ctx.setLineDash([]);
  
  for(let x=road.x; x<= road.x + road.width - crosswalk.barWidth; x+= (crosswalk.barWidth+crosswalk.gap)){
    ctx.fillStyle='#fff'; ctx.fillRect(x, crosswalk.y, crosswalk.barWidth, crosswalk.height);
  }
  ctx.strokeStyle='#fff'; ctx.lineWidth=3; ctx.strokeRect(road.x, crosswalk.y, road.width, crosswalk.height);
  
  drawLight(lightPos.x, lightPos.y, state.light);
  drawDestination(goal);

  for(const p of state.peers){
    if (p.hidden) continue;
    circle(p.x,p.y,p.r, PEER.color, 2, PEER.stroke);
  }
  
  if (state.player) circle(state.player.x,state.player.y,state.player.r, PLAYER.color, 2, PLAYER.stroke);
  
  if (state.car){
    const {x, y, w, h} = state.car;
    ctx.save();
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#f87171';
    ctx.fillRect(x + 4, y + 4, w - 8, h * 0.25);
    ctx.fillStyle = '#60a5fa';
    ctx.fillRect(x + 4, y + h * 0.3, w - 8, h * 0.25);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(x - 3, y + 6, 3, 18);
    ctx.fillRect(x - 3, y + h - 24, 3, 18);
    ctx.fillRect(x + w, y + 6, 3, 18);
    ctx.fillRect(x + w, y + h - 24, 3, 18);
    ctx.restore();
  }
}

function circle(x,y,r,fill,lw=0,stroke=null){
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
  ctx.fillStyle=fill; ctx.fill();
  if (lw>0){ ctx.lineWidth=lw; ctx.strokeStyle=stroke||'#000'; ctx.stroke(); }
}

function drawDestination(area){
  const pad = 8;
  const boxX = area.x, boxY = area.y, boxW = area.w, boxH = area.h;

  if (destImg && destImgReady) {
    const iw = destImg.naturalWidth || destImg.width;
    const ih = destImg.naturalHeight || destImg.height;
    const scale = Math.min( (boxW - pad*2) / iw, (boxH - pad*2) / ih );
    const dw = Math.max(1, Math.floor(iw * scale));
    const dh = Math.max(1, Math.floor(ih * scale));
    const dx = Math.floor(boxX + (boxW - dw)/2);
    const dy = Math.floor(boxY + (boxH - dh)/2);
    ctx.drawImage(destImg, dx, dy, dw, dh);
    ctx.strokeStyle = '#6b7280';
    ctx.strokeRect(boxX, boxY, boxW, boxH);
  } else {
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#6b7280';
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(boxX + boxW*0.1, boxY + boxH*0.35);
    ctx.lineTo(boxX + boxW*0.5, boxY + boxH*0.12);
    ctx.lineTo(boxX + boxW*0.9, boxY + boxH*0.35);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#cbd5e1';
    const bodyX = boxX + boxW*0.12;
    const bodyY = boxY + boxH*0.35;
    const bodyW = boxW*0.76;
    const bodyH = boxH*0.5;
    ctx.fillRect(bodyX, bodyY, bodyW, bodyH);

    ctx.fillStyle = '#475569';
    const doorW = bodyW*0.16, doorH = bodyH*0.45;
    ctx.fillRect(bodyX + bodyW*0.42, bodyY + bodyH - doorH, doorW, doorH);

    ctx.fillStyle = '#93c5fd';
    const winW = bodyW*0.18, winH = bodyH*0.22;
    ctx.fillRect(bodyX + bodyW*0.12, bodyY + bodyH*0.18, winW, winH);
    ctx.fillRect(bodyX + bodyW*0.70, bodyY + bodyH*0.18, winW, winH);
  }

  ctx.save();
  ctx.fillStyle = '#0f172a';
  ctx.font = '16px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const textY = boxY + boxH + 6;
  ctx.fillText(goal.label || '目的地', boxX + boxW/2, textY);
  ctx.restore();
}

// ============ 动画循环 ============
let last = performance.now();
function loop(ts){
  const dt = (ts - last)/1000; last = ts;

  if (state.phase==='present' || state.phase==='decide' || state.phase==='animate'){
    if (curTrial().Social_Norm==='Crossing'){
      for (const p of state.peers){
        if (p.hidden) continue;
        const goalX = goal.x;
        const goalY = Math.round(H/2) + (p.laneOffset || 0);
        const dx = goalX - p.x;
        const dy = goalY - p.y;
        const dist = Math.hypot(dx,dy);
        const step = Math.min(p.speed*dt, dist);
        if (dist > 1){
          p.x += (dx/dist) * step;
          p.y += (dy/dist) * step;
        } else {
          p.hidden = true;
        }
      }
    }
    else if (curTrial().Social_Norm==='Crosswalk'){
      const yCW = crosswalk.y + crosswalk.height/2;
      const xL = road.x + 8;
      const xR = road.x + road.width - 8;

      for (const p of state.peers){
        if (p.hidden) continue;
        if (!p.path){
          const yLane = yCW + (p.laneOffset || 0);
          p.path = [
            {x:xL, y:yLane},
            {x:xR, y:yLane},
            {x:goal.x, y:yLane} 
          ];
          p.wp = 0;
        }
        const wp = p.path[p.wp];
        if (!wp){ p.hidden = true; continue; }
        const dx = wp.x - p.x, dy = wp.y - p.y;
        const dist = Math.hypot(dx,dy);
        const step = Math.min(p.speed*dt, dist);
        if (dist>1){
          p.x += (dx/dist)*step;
          p.y += (dy/dist)*step;
        }else{
          p.wp++;
        }
      }
    }

    if (state.car){
      const stopY = sidewalkLeft.y - state.car.h - 60;
      state.car.y = Math.min(state.car.y + state.car.vy * dt, stopY);
      if (state.car.y >= stopY) state.car.vy = 0;
    }
  }

  if (state.phase==='animate' && state.player && state.player.path){
    const wp = state.player.path[state.player.wp];
    if (wp){
      const dx = wp.x - state.player.x, dy = wp.y - state.player.y;
      const dist = Math.hypot(dx,dy);
      if (dist>1){
        const step = Math.min(state.player.speed*dt, dist);
        state.player.x += (dx/dist)*step;
        state.player.y += (dy/dist)*step;
      }else{
        state.player.wp++;
      }
    }else{
      state.phase='feedback';
      setTimeout(()=>{ openQuestionnaire(); }, 800);
    }
  }

  if (checkCollisionAndEnd()) {
    requestAnimationFrame(loop);
    return;
  }

  if (state.phase==='present' || state.phase==='decide' || state.phase==='animate'){
    separateEntities(state.player, state.peers);
  }

  draw();
  requestAnimationFrame(loop);
}

// ============ Trial 流程 ============
function curTrial(){ return trials[tIndex]; }

function preloadPhase(){
  state.phase='preload';
  state.preloadStart = performance.now();
  setTimeout(()=>presentPhase(), 500);
}

function presentPhase(){
  state.phase='present';
  state.presentStart = performance.now();

  const peersN = (curTrial().Social_Norm==='NoPed') ? 0 : 3;
  const pos = defaultPositions(peersN);
  state.player = pos.player;
  state.peers = pos.peers;
  state._startX = state.player.x;
  state._startY = state.player.y;

  const carRisk = curTrial().Car_Risk;
  if (carRisk==='NoCar'){
    state.car = null;
  }else{
    const vy = (carRisk==='LowSpeed') ? CAR.slow : CAR.fast;
    const rx = road.x + 30;
    state.car = { x: rx-10, y: -CAR.h - 10, w: CAR.w, h: CAR.h, vy: vy };
  }

  state.light = (curTrial().Signal_State==='RedLight') ? 'red' : 'green';

  setTimeout(()=>decidePhase(), 10);
}

function decidePhase(){
  state.phase='decide';
  state.rtStart = performance.now();
  state.decisionTime = null;
  state.choice = null;
  state.collision = 0;
}

function animatePhase(){
  state.phase='animate';
}

function openQuestionnaire(){
  state.phase='question';
  btnSubmitTrial.disabled = true;
  
  ['q1','q2','q3'].forEach(name => {
    document.querySelectorAll(`input[name="${name}"]`).forEach(n => n.checked=false);
  });
  
  modalTrial.classList.add('show');
}

function endTrial(){
  modalTrial.classList.remove('show');

  state.player = null;
  state.peers = [];
  state.car = null;
  draw();

  tIndex++;
  
  if (tIndex >= trials.length){
    openPostSurvey();
  } else {
    setTimeout(()=>{ preloadPhase(); }, 500);
  }
}

// ============ 决策点击 ============
cvs.addEventListener('mousedown', (e)=>{
  if (state.phase!=='decide') return;
  const rect = cvs.getBoundingClientRect();
  const cx = clamp(e.clientX - rect.left, 0, W);
  const cy = clamp(e.clientY - rect.top, 0, H);

  const inRoad = (cx >= road.x && cx <= road.x + road.width);
  const inCross = (inRoad && cy >= crosswalk.y && cy <= crosswalk.y + crosswalk.height);
  const inDirect = (inRoad && !inCross);

  if (!inCross && !inDirect) return;

  state.decisionTime = Math.round(performance.now() - state.rtStart);
  state.choice = inCross ? 1 : 2;

  if (state.choice===1){
    const yCW = crosswalk.y + crosswalk.height/2;
    const xL = road.x + 8;
    const xR = road.x + road.width - 8;
    state.player.path = [
      {x:xL,y:yCW},
      {x:xR,y:yCW},
      {x:goal.x, y:yCW}
    ];
  }else{
    const yMid = Math.round(H/2);
    state.player.path = [{ x: goal.x, y: yMid }];
  }
  
  state.player.wp = 0;
  state.player.moving = true;

  if (state.choice===2 && state.car){
    state.collision = simulateCollision(state.player, state.car);
  }

  if (state.collision === 1) {
    state.phase = 'feedback';
    state.player.moving = false;
    setTimeout(()=>{ openQuestionnaire(); }, 500);
    return;
  }

  animatePhase();
});

function separateEntities(player, peers){
  const all = [];
  if (player) all.push(player);
  if (peers && peers.length) {
    for (const p of peers) if (p && !p.hidden) all.push(p);
  }
  for (let i=0;i<all.length;i++){
    const a = all[i];
    for (let j=i+1;j<all.length;j++){
      const b = all[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx,dy);
      const minD = (a.r || 8) + (b.r || 8) + 2;
      if (d > 0 && d < minD){
        const ux = dx / d, uy = dy / d;
        const push = (minD - d) / 2;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
      }
    }
  }
}

function simulateCollision(player, car){
  const yMid = Math.round(H/2);
  const px0 = player.x, px1 = goal.x + goal.w/2;
  const pDist = Math.abs(px1 - px0), pTime = pDist / player.speed;
  const carStartY = car.y, carV = car.vy;
  const carTime = (yMid - carStartY) / carV;
  const playerCrossX = (px0 + px1)/2;
  const carXrange = [car.x, car.x + car.w];
  const overlapX = (playerCrossX >= carXrange[0] && playerCrossX <= carXrange[1]);
  return (Math.abs(pTime - carTime) < 0.6 && overlapX) ? 1 : 0;
}

// ============ 问卷逻辑 ============
function checkedValue(groupId){
  const nodes = document.querySelectorAll(`input[name="${groupId}"]`);
  for (const n of nodes) if (n.checked) return n.value;
  return null;
}

// Trial 问卷验证
modalTrial.addEventListener('change', ()=>{
  const q1 = checkedValue('q1');
  const q2 = checkedValue('q2');
  const q3 = checkedValue('q3');
  btnSubmitTrial.disabled = !(q1 && q2 && q3);
});

// Trial 问卷提交
btnSubmitTrial.addEventListener('click', ()=>{
  const dv1 = parseInt(checkedValue('q1'),10);
  const dv2 = parseInt(checkedValue('q2'),10);
  const dv3 = parseInt(checkedValue('q3'),10);

  const row = buildRowMatrix(dv1, dv2, dv3);
  trialRows.push(row);
  console.log('[TRIAL DATA]', row);
  
  endTrial();
});

function buildRowMatrix(dv1, dv2, dv3){
  const t = curTrial();
  return {
    Participant_ID: participantId,
    Group_ID: groupId,
    Trial_Num: tIndex+1,
    Car_Risk: t.Car_Risk,
    Signal_State: t.Signal_State,
    Social_Norm: t.Social_Norm,
    DV_A_Choice: state.choice,
    RT_ms: state.decisionTime,
    DV_Collision: (state.choice===2 ? state.collision : 0),
    DV1_RiskAgree: dv1,
    DV2_SocialConsider: dv2,
    DV3_NoticedSignal: dv3
  };
}

// ============ 开始按钮 ============
btnStart.addEventListener('click', ()=>{
  modalStart.classList.remove('show');
  preloadPhase();
});

// ============ 实验后问卷 ============
function openPostSurvey(){
  modalPost1.classList.add('show');
  buildLikert5Agree(document.getElementById('post_overconf'), 'post_overconf');
  buildLikert5Agree(document.getElementById('bsss1'), 'bsss1');
  buildLikert5Agree(document.getElementById('bsss2'), 'bsss2');
  buildLikert5Agree(document.getElementById('bsss3'), 'bsss3');
  buildLikert5Agree(document.getElementById('bsss4'), 'bsss4');
  buildLikert5Agree(document.getElementById('bsss5'), 'bsss5');
  buildLikert5Agree(document.getElementById('bsss6'), 'bsss6');
  buildLikert5Agree(document.getElementById('bsss7'), 'bsss7');
  buildLikert5Agree(document.getElementById('bsss8'), 'bsss8');
}

function buildLikert5Agree(container, name){
  container.innerHTML = '';
  const labels = ['非常不同意','不同意','中立','同意','非常同意'];
  for (let i=1; i<=5; i++){
    const id = `${name}_${i}`;
    const lab = document.createElement('label');
    lab.innerHTML = `<input type="radio" name="${name}" value="${i}" id="${id}"> ${labels[i-1]}`;
    container.appendChild(lab);
  }
}
// Post 问卷第1页验证
modalPost1.addEventListener('change', ()=>{
  const age = document.getElementById('post_age').value.trim();
  const gender = checkedValue('post_gender');
  btnPost1Next.disabled = !(age && gender);
});

modalPost1.addEventListener('input', ()=>{
  const age = document.getElementById('post_age').value.trim();
  const gender = checkedValue('post_gender');
  btnPost1Next.disabled = !(age && gender);
});

// Post 问卷第1页提交
btnPost1Next.addEventListener('click', ()=>{
  const age = document.getElementById('post_age').value.trim();
  const gender = checkedValue('post_gender');
  if (!age || !gender){ 
    alert('请填写年龄并选择性别'); 
    return; 
  }
  modalPost1.classList.remove('show');
  modalPost2.classList.add('show');
});

// Post 问卷第2页验证
modalPost2.addEventListener('change', ()=>{
  const driver = checkedValue('post_driver');
  const cycle = checkedValue('post_cycle');
  const overconf = checkedValue('post_overconf');
  const bsss1 = checkedValue('bsss1');
  const bsss2 = checkedValue('bsss2');
  const bsss3 = checkedValue('bsss3');
  const bsss4 = checkedValue('bsss4');
  const bsss5 = checkedValue('bsss5');
  const bsss6 = checkedValue('bsss6');
  const bsss7 = checkedValue('bsss7');
  const bsss8 = checkedValue('bsss8');
  
  btnPostSubmit.disabled = !(
    driver && cycle && overconf && 
    bsss1 && bsss2 && bsss3 && bsss4 && 
    bsss5 && bsss6 && bsss7 && bsss8
  );
});

// Post 问卷第2页提交
btnPostSubmit.addEventListener('click', ()=>{
  const age = document.getElementById('post_age').value.trim();
  const gender = checkedValue('post_gender');
  const driver = checkedValue('post_driver');
  const cycle = checkedValue('post_cycle');
  const overconf = checkedValue('post_overconf');
  
  const bsss1 = checkedValue('bsss1');
  const bsss2 = checkedValue('bsss2');
  const bsss3 = checkedValue('bsss3');
  const bsss4 = checkedValue('bsss4');
  const bsss5 = checkedValue('bsss5');
  const bsss6 = checkedValue('bsss6');
  const bsss7 = checkedValue('bsss7');
  const bsss8 = checkedValue('bsss8');

  if (!age || !gender || !driver || !cycle || !overconf || 
      !bsss1 || !bsss2 || !bsss3 || !bsss4 || 
      !bsss5 || !bsss6 || !bsss7 || !bsss8) {
    alert('请完整填写所有必填项'); 
    return;
  }

  const payload = {
    Participant_ID: participantId,
    Age: parseInt(age,10),
    Gender: gender,
    Driver: driver,
    Cycle: cycle,
    Overconfidence: parseInt(overconf,10),
    BSSS1: parseInt(bsss1,10),
    BSSS2: parseInt(bsss2,10),
    BSSS3: parseInt(bsss3,10),
    BSSS4: parseInt(bsss4,10),
    BSSS5: parseInt(bsss5,10),
    BSSS6: parseInt(bsss6,10),
    BSSS7: parseInt(bsss7,10),
    BSSS8: parseInt(bsss8,10)
  };
  
  const fullData = { trials: trialRows, post: payload };
  
  console.log('[POST-SURVEY]', payload);
  console.log('[FULL DATA]', fullData);
  
  // 上传到服务器
  uploadToServer(fullData, participantId)
    .then(() => {
      console.log('✅ 数据上传成功');
     // downloadJSON(fullData, `${participantId}_data.json`);
     // downloadCSV(trialRows, `${participantId}_trials.csv`);
      
      modalPost2.classList.remove('show');
      alert('问卷已提交，数据已上传，感谢参与！');
    })
    .catch(err => {
      console.error('❌ 数据上传失败:', err);
      downloadJSON(fullData, `${participantId}_data.json`);
      downloadCSV(trialRows, `${participantId}_trials.csv`);
      
      modalPost2.classList.remove('show');
      alert('数据上传失败，但已保存本地备份！请将下载的文件发送给研究人员。');
    });
});

// ============ 数据上传（简易中国可用方案）============
function uploadToServer(data) {
  return fetch("http://146.56.193.211/exp/save.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }).then(async (res) => {
    const txt = await res.text();
    let json = {};
    try { json = JSON.parse(txt); } catch (_) {}
    if (!res.ok || !json.ok) throw new Error('HTTP '+res.status+' '+(json.error||txt));
    return json;
  });
}



// ============ 下载工具 ============
function downloadJSON(obj, filename){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename; 
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadCSV(rows, filename){
  if (!rows.length){ 
    alert('无试次数据'); 
    return; 
  }
  const keys = Object.keys(rows[0]);
  const csv = [
    keys.join(','),
    ...rows.map(r => keys.map(k => JSON.stringify(r[k]??'')).join(','))
  ].join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename; 
  a.click();
  URL.revokeObjectURL(a.href);
}

// ============ 启动 ============
function initUI(){
  requestAnimationFrame(ts=>{ last=ts; loop(ts); });
}
initUI();

// Post


