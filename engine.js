/* 필카운터 계수 엔진 — 화면과 분리된 백그라운드 작업(Web Worker)에서 실행 */
let W=0,H=0,lab=null,photo=null,seed=null,TOL=20,HINT=null;   // HINT: 손으로 테두리를 그려 지정한 기준 물체 {L,A,B,area}

/* ---------- 색 변환 (sRGB → Lab) ---------- */
function toLab(d){
  const n=d.length/4, out=new Float32Array(n*3);
  const lin=v=>{v/=255;return v>0.04045?Math.pow((v+0.055)/1.055,2.4):v/12.92};
  const LUT=new Float32Array(256); for(let i=0;i<256;i++)LUT[i]=lin(i);
  const f=t=>t>0.008856?Math.cbrt(t):7.787*t+16/116;
  for(let i=0;i<n;i++){
    const r=LUT[d[i*4]],g=LUT[d[i*4+1]],b=LUT[d[i*4+2]];
    const X=f((r*0.4124+g*0.3576+b*0.1805)/0.95047), Y=f(r*0.2126+g*0.7152+b*0.0722), Z=f((r*0.0193+g*0.1192+b*0.9505)/1.08883);
    out[i*3]=116*Y-16; out[i*3+1]=500*(X-Y); out[i*3+2]=200*(Y-Z);
  }
  return out;
}

/* ---------- 계수 알고리즘 ---------- */
function count(){
  const N=W*H, T=TOL;
  // 1) 기준 색: 터치 지점 주변 평균
  let L=0,A=0,B=0,c=0;
  for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
    const x=seed.x+dx,y=seed.y+dy; if(x<0||y<0||x>=W||y>=H)continue;
    const i=(y*W+x)*3; L+=lab[i];A+=lab[i+1];B+=lab[i+2];c++;
  }
  L/=c;A/=c;B/=c;
  if(HINT){L=HINT.L;A=HINT.A;B=HINT.B;}               // 테두리로 지정한 물체의 평균색을 그대로 기준으로
  // 기준색 다듬기: 터치한 한 점이 아니라 '비슷한 색 전체'의 평균으로 (그림자·반사 쪽을 눌러도 결과가 같게)
  const L0=L,A0=A,B0=B;
  for(let it=0;it<5;it++){
    let sl=0,sa=0,sb=0,n=0;
    for(let i=0;i<N;i+=2){const dl=(lab[i*3]-L)*0.5,da=lab[i*3+1]-A,db=lab[i*3+2]-B;
      if(dl*dl+da*da+db*db<(it<2?400:196)){sl+=lab[i*3];sa+=lab[i*3+1];sb+=lab[i*3+2];n++}}
    if(n<=50) break;
    const nl=sl/n,na=sa/n,nb=sb/n;
    if(Math.hypot((nl-L0)*0.5,na-A0,nb-B0)>20) break;   // 다른 색(테두리·배경) 쪽으로 끌려가면 멈춤
    L=nl;A=na;B=nb;
  }
  // 2) 색 거리 지도 → 히스토그램의 첫 골짜기를 자동 경계값으로 사용 (조명 차이에 강함)
  const dmap=new Float32Array(N), hist=new Float32Array(121);
  for(let i=0;i<N;i++){
    const dl=(lab[i*3]-L)*0.5, da=lab[i*3+1]-A, db=lab[i*3+2]-B;
    const d=Math.sqrt(dl*dl+da*da+db*db); dmap[i]=d; hist[Math.min(120,d|0)]++;
  }
  const sm=hist.map((_,i)=>{let v=0,c=0;for(let j=i-3;j<=i+3;j++)if(j>=0&&j<=120){v+=hist[j];c++}return v/c});
  let pk=0; for(let i=1;i<=25;i++) if(sm[i]>sm[pk]) pk=i;
  let th=Math.min(60,pk+8); for(let i=pk+1;i<=60;i++){ if(sm[i]<sm[th]) th=i; if(sm[i]>sm[th]*1.8 && i>th+3) break; }
  // 경계값이 약 자체 색 퍼짐보다 지나치게 넓으면(반사·밝은 바닥까지 잡힘) 줄임
  { const ds=[]; for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const x=seed.x+dx,y=seed.y+dy;if(x>=0&&y>=0&&x<W&&y<H)ds.push(dmap[y*W+x])}
    ds.sort((a,b)=>a-b); const spread=ds[Math.floor(ds.length*0.8)]||4;
    if(Math.hypot(A,B)<14) th=Math.min(th,Math.max(10,spread*2+6)); }   // 흰·회색 약만: 반사광과 색이 같아서 경계를 좁힘
  th=Math.max(th,10)*(T/20);
  let mask=new Uint8Array(N);
  for(let i=0;i<N;i++) if(dmap[i]<th) mask[i]=1;
  // 3) 빛 반사 보정: 약 위의 하얗게 번쩍이는 부분(밝고 색이 빠진 픽셀)은
  //    약에 붙어 있을 때만 약으로 채움 → 반사 때문에 한 알이 둘로 쪼개져 세지는 것 방지
  const C0=Math.hypot(A,B);
  const glare=new Uint8Array(N);
  for(let i=0;i<N;i++){const l=lab[i*3],c=Math.hypot(lab[i*3+1],lab[i*3+2]);
    if(l>Math.max(L+12,92)&&c<12) glare[i]=1;}   // 거의 흰색(반사광)만 — 밝은 회색 쟁반·약 사이 틈은 제외
  // 반사 덩어리 중 '작고' '약에 닿아 있는' 것만 채움 (넓게 밝은 쟁반·종이는 제외)
  { const gl=label(glare), near=dilate(dilate(mask)), maxG=N*0.0012;
    gl.blobs.forEach(px=>{ if(px.length>maxG) return; let touch=0; for(const p of px) if(near[p]){touch=1;break}
      if(touch) px.forEach(p=>mask[p]=1); }); }
  // 약 안의 글씨·각인·작은 반사 구멍(아주 작은 빈칸)만 메움 — 약 사이 틈은 그대로 둠
  mask=fillSmallHoles(mask,Math.max(12,N*0.00004));
  mask=fillRoundHoles(mask);                         // 가운데 구멍이 있는 물체(와셔·링 부품·구멍 뚫린 정제)는 한 덩어리로
  // 4) 노이즈 제거: 가장자리의 반짝이는 점·먼지 제거
  mask=dilate(erode(mask));
  // 반사로 생긴 '약이 아닌 조각' 제거: 반사 픽셀이 대부분인 덩어리는 버림
  { const fl=label(mask); fl.blobs.forEach(px=>{let gc=0;for(const p of px)if(glare[p])gc++; if(gc>px.length*0.5)px.forEach(p=>mask[p]=0)}); }
  // 5) 거리 변환: 약 안쪽일수록 값이 큼 → 붙은 약 사이 경계는 값이 작음
  const dist=distT(mask);
  // 5) 기준 약 두께: 터치 지점 주변의 최대 거리값
  let r0=0; const R=25;
  for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){const x=seed.x+dx,y=seed.y+dy;if(x<0||y<0||x>=W||y>=H)continue;r0=Math.max(r0,dist[y*W+x])}
  if(r0<2) return {pts:[],r:10,mask};
  // 약 두께도 사진 전체에서 가장 흔한 값으로 (기준 약이 무더기 속에 있어도 흔들리지 않게)
  { const fl=label(mask), md=[];
    fl.blobs.forEach(px=>{ if(px.length<8) return; let m=0; for(const p of px) if(dist[p]>m) m=dist[p]; md.push(m*m); });
    const c=commonSize(md,r0*r0); if(c>4) r0=Math.sqrt(c); }
  // 6) 약 중심부(core)만 남겨 붙은 약을 분리
  const core=new Uint8Array(N); for(let i=0;i<N;i++) if(dist[i]>r0*0.55) core[i]=1;
  const {lbl,blobs:coreList}=label(core);
  let blobs=coreList;
  // 기준 core = 터치 지점에서 가장 가까운 core
  let ref=-1,best=1e9;
  blobs.forEach((px,k)=>{for(let j=0;j<px.length;j+=4){const p=px[j],d=Math.hypot(p%W-seed.x,(p/W|0)-seed.y);if(d<best){best=d;ref=k}}});
  let unit=blobs[ref].length;
  // 1알 크기 = 사진 전체에서 '가장 흔한' 중심부 크기 (터치한 약이 글씨·반사로 쪼개져 작게 잡혀도 흔들리지 않음)
  unit=commonSize(blobs.map(b=>b.length),unit);
  const refPix=blobs[ref][0];
  // 6-2) 1알보다 큰 중심부는 더 깊은 곳(가운데)만 다시 봐서 봉우리가 여러 개면 따로 셈
  //      → 빽빽하게 붙은 둥근 약·바이알에서 이웃끼리 이어진 중심부를 정확히 나눔
  { const out=[];
    blobs.forEach(px=>{
      if(px.length<unit*1.5){out.push(px);return}
      for(const lv of [0.72,0.85]){
        const parts=labelSubset(px.filter(p=>dist[p]>r0*lv)).filter(q=>q.length>=3);
        const r=px.length/unit, areaK=r<1.7?1:Math.round(r-0.15);
        if(parts.length>=2&&parts.length>=areaK){parts.forEach(q=>{q.sub=true;out.push(q)});return}
      }
      out.push(px);
    });
    blobs=out; }
  // 7) 약 덩어리(전체 모양) 단위로 분석
  const full=label(mask);
  const coresOf=full.blobs.map(()=>[]);
  blobs.forEach((px,k)=>coresOf[full.lbl[px[0]]].push(k));
  const coreK=px=>{if(px.sub)return 1;const r=px.length/unit;return r<0.35?0:r<1.7?1:Math.round(r-0.15)};
  // 덩어리별 '하얗게 날아간(255에 가까운) 픽셀' 비율과 테두리 거칠기 → 빛 반사 판별용
  const pd=photo.data;
  const blobFeat=px=>{let clip=0,edge=0;for(const p of px){const j=p*4;if(pd[j]>245&&pd[j+1]>245&&pd[j+2]>245)clip++;
      const x=p%W;if(x==0||x==W-1||p<W||p>=N-W||!mask[p-1]||!mask[p+1]||!mask[p-W]||!mask[p+W])edge++}
    return {clip:clip/px.length,rough:edge*edge/(4*Math.PI*px.length)}};
  const meanDE=px=>{let l=0,a=0,b=0;for(const p of px){l+=lab[p*3];a+=lab[p*3+1];b+=lab[p*3+2]}const n=px.length;return Math.hypot((l/n-L)*0.5,a/n-A,b/n-B)};
  const info=full.blobs.map((px,f)=>({px,f,shape:pca(px),...blobFeat(px),dE:meanDE(px),n:coresOf[f].reduce((s,k)=>s+coreK(blobs[k]),0)}));
  // 기준 약 1알의 모양 = 터치한 약과 비슷한 '단독' 덩어리들의 중앙값
  const sf=full.lbl[refPix], sInfo=info[sf];
  const sArea=HINT?HINT.area:commonSize(info.filter(o=>o.n===1).map(o=>o.px.length),sInfo.px.length/Math.max(1,sInfo.n));
  const singles=info.filter(o=>o.n===1&&o.px.length>sArea*0.7&&o.px.length<sArea*1.4);
  const med=f=>{const v=singles.map(f).sort((a,b)=>a-b);return v[v.length>>1]};
  const Ap=singles.length>=3?med(o=>o.px.length):sArea;
  // 중심부의 길쭉한 정도(길이/폭): 단독 약들의 중심부 기준값
  const aspect=px=>{const q=pca(px);return q.len/Math.max(1,q.wid)};
  const singleCores=singles.map(o=>coresOf[o.f].find(c=>coreK(blobs[c])===1)).filter(c=>c!==undefined);
  const refAsp=singleCores.length>=3?singleCores.map(c=>aspect(blobs[c])).sort((a,b)=>a-b)[singleCores.length>>1]:null;
  const refDE=singles.length>=3?med(o=>o.dE):sInfo.dE, refRough=singles.length>=3?med(o=>o.rough):sInfo.rough, refClip=singles.length>=3?med(o=>o.clip):sInfo.clip;
  const Lp=singles.length>=3?med(o=>o.shape.len):sInfo.shape.len;
  const Wp=singles.length>=3?med(o=>o.shape.wid):sInfo.shape.wid;
  // 8) 덩어리마다 유형 판정 + 개수
  const pts=[], stat={단독:0,붙음:0,겹침:0,눕힘:0,세움:0,제외:0};
  info.forEach(o=>{
    const area=o.px.length, ratio=area/Ap, sh=o.shape;
    if(ratio<0.15||(ratio<0.3&&sh.wid<Wp*0.4)) return;     // 부스러기·노이즈 (세운 약은 작지만 둥글어서 통과)
    // 빛 반사: 기준 약보다 훨씬 하얗게 날아갔거나, 테두리가 약답지 않게 들쭉날쭉하면 버림
    if(o.clip>Math.max(0.2,refClip+0.15)) return;
    // 빛 반사·바닥 무늬: 기준 약과 색이 꽤 다르거나, 테두리가 약 무더기보다 훨씬 들쭉날쭉하면 세지 않음
    const whitish=Math.hypot(A,B)<14;
    if(whitish&&o.dE>Math.max(7,refDE*3+4)) return;
    const good=coresOf[o.f].filter(c=>blobs[c].sub||(blobs[c].length>unit*0.6&&blobs[c].length<unit*1.6));
    if(whitish&&o.rough>Math.max(2.4,refRough*2.2)&&good.length<ratio*0.6){
      // 약 + 반사가 엉겨 붙은 덩어리(면적에 비해 1알 크기 중심부가 적음): 1알 크기 중심부만 약으로 셈, 반사 조각은 무시
      // (보통 약 무더기는 면적만큼 중심부가 있어서 이 경로를 타지 않음)
      stat.반사=(stat.반사||0)+1;
      good.forEach(c=>{const q=kmeans(blobs[c],1)[0];pts.push({x:q.x,y:q.y,type:'붙음'});stat.붙음++});
      return;
    }
    if(o.n<=1&&o.rough>Math.max(2.2,refRough*1.8)) return;
    let k=o.n, type;
    if(k<=1){
      // 겹친 약: 길거나 넓어지되, 폭이 1알보다 좁아질 수는 없음(좁으면 모양이 다른 물건)
      if(ratio>1.15&&sh.wid>=Wp*0.85&&(sh.len>Lp*1.35||sh.wid>Wp*1.45)){ k=Math.max(2,Math.round(ratio-0.1)); type='겹침'; }
      else{
        k=1;
        const round=Lp<Wp*1.3;
        if(ratio>=0.32&&ratio<=0.68&&(
             (!round&&sh.len<Lp*0.75&&sh.wid>Wp*0.75) ||               // 긴 약을 가로로 자른 반알: 길이만 절반
             (round&&sh.len>Lp*0.8&&sh.wid>Wp*0.42&&sh.wid<Wp*0.75)))  // 둥근 약 반알: 반달 모양
          type='제외';                                          // 반알·조각: 온알 개수에 넣지 않음
        // 기준 약과 '같은 모습'일 때만 셈: 면적·길이·폭이 모두 기준 범위 안
        else if(ratio>=0.65&&ratio<=1.5&&sh.len>=Lp*0.75&&sh.len<=Lp*1.3&&sh.wid>=Wp*0.7&&sh.wid<=Wp*1.4) type='단독';
        else return;                                           // 기준과 다른 모양(다른 물건·그림자·무늬)은 세지 않음
      }
    }else{
      // 붙은 무더기: 약 1알마다 중심부 크기로 판정 — 일부가 가려져 중심부가 작으면 '겹침'
      const cs=coresOf[o.f].filter(c=>coreK(blobs[c])>0);
      // 중심부가 하나뿐인데 면적만 큰 '뭉툭한' 물체 = 약 여러 알이 아니라 크기가 다른 다른 물건 → 세지 않음
      // (약이 맞닿으면 길쭉해지고, 빽빽한 무더기는 중심부가 여러 개로 나뉨)
      if(cs.length===1&&!blobs[cs[0]].sub&&sh.len<Lp*1.45&&sh.wid<Wp*1.45) return;
      if(sh.wid<Wp*0.8) return;                      // 기준 약 무더기는 1알보다 좁을 수 없음 → 더 가는 다른 물건
      const blobOverlap=area/k<Ap*0.85&&k<=4;   // 작은 무더기인데 1알당 면적이 줄었으면 서로 가린 것
      cs.forEach(c=>{
        const kc=coreK(blobs[c]), cr=blobs[c].sub?1:blobs[c].length/unit;
        // 1알짜리 중심부인데 길쭉한 정도가 기준과 크게 다르면 다른 모양의 물건(예: 원형 기준일 때 장방형)
        if(kc===1&&refAsp&&blobs[c].length>=3){const a=aspect(blobs[c]);if(a>refAsp*1.5||a<refAsp/1.5)return}
        const t=(kc===1&&cr<0.6)||blobOverlap?'겹침':'붙음';
        kmeans(blobs[c],kc).forEach(p=>{pts.push({x:p.x,y:p.y,type:t});stat[t]++});
      });
      // 면적으로 보면 더 있어야 하는 경우 = 아래에 완전히 깔린 약 → 빈 자리에 '겹침'으로 추가
      const extra=Math.round(ratio-0.2)-k;
      if(extra>0){
        const have=pts.slice(-k), cand=kmeans(o.px,k+extra);
        cand.map(c=>({c,d:Math.min(...have.map(h=>Math.hypot(h.x-c.x,h.y-c.y)))}))
          .sort((a,b)=>b.d-a.d).slice(0,extra)
          .forEach(({c})=>{pts.push({x:c.x,y:c.y,type:'겹침'});stat.겹침++});
      }
      return;
    }
    stat[type]+=k;
    const centers=kmeans(o.px,k);
    centers.forEach(c=>pts.push({x:c.x,y:c.y,type}));
  });
  // 물체가 주변과 뚜렷이 구분되는지(대비): 덩어리 바로 바깥 테두리의 평균색과 기준색 차이
  let rl=0,ra=0,rb=0,rn=0; { const d3=dilate(dilate(dilate(mask))); for(let i=0;i<N;i+=2) if(d3[i]&&!mask[i]){rl+=lab[i*3];ra+=lab[i*3+1];rb+=lab[i*3+2];rn++} }
  const contrast=rn?Math.hypot((rl/rn-L)*0.5,ra/rn-A,rb/rn-B):0;
  return {pts,stat,r:r0*1.6,mask,contrast,singles:stat.단독+stat.붙음};   // 기준과 같은 크기로 확인된 알 수
}

function commonSize(areas,hint){
  // 크기 분포(로그 눈금)에서 가장 많이 몰린 구간 → 그 근처 값들의 중앙값
  const a=areas.filter(v=>v>=Math.max(4,hint*0.25)); if(a.length<3) return hint;
  const bins=new Map(); a.forEach(v=>{const b=Math.round(Math.log(v)/0.12);bins.set(b,(bins.get(b)||0)+1)});
  let best=0,bc=-1; bins.forEach((c,b)=>{const sc=c+0.6*((bins.get(b-1)||0)+(bins.get(b+1)||0));if(sc>bc){bc=sc;best=b}});
  const m=Math.exp(best*0.12), near=a.filter(v=>v>m*0.75&&v<m*1.33).sort((x,y)=>x-y);
  return near.length?near[near.length>>1]:hint;
}

/* 자동 기준 찾기: 사진에서 '같은 크기·색·모양으로 가장 많이 반복되는 물체'를 약으로 보고 그 중심을 기준점으로 */
function autoSeed(){
  // 속도를 위해 작은 사본(긴 변 240px)에서 찾고, 좌표만 원래 크기로 되돌림
  const k=Math.min(1,240/Math.max(W,H)), sw=Math.round(W*k), sh=Math.round(H*k);
  const big={W,H,lab}, small=new Float32Array(sw*sh*3);
  for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){const si=((y/k|0)*big.W+(x/k|0))*3,di=(y*sw+x)*3;small[di]=lab[si];small[di+1]=lab[si+1];small[di+2]=lab[si+2]}
  W=sw;H=sh;lab=small;
  let r=null; try{ r=autoSeedCore(); } finally { W=big.W;H=big.H;lab=big.lab; }
  return r&&{x:Math.min(W-1,Math.round(r.x/k)),y:Math.min(H-1,Math.round(r.y/k))};
}
function autoSeedCore(){
  const N=W*H, Q=12;
  // 1) 사진의 주요 색 10가지 (거친 색 구간별 픽셀 수)
  const hist=new Map();
  for(let i=0;i<N;i+=2){const k=((lab[i*3]/Q)|0)*10000+(((lab[i*3+1]+128)/Q)|0)*100+(((lab[i*3+2]+128)/Q)|0);hist.set(k,(hist.get(k)||0)+1)}
  const colors=[...hist.entries()].sort((x,y)=>y[1]-x[1]).slice(0,10).map(([k])=>({
    L:((k/10000|0)+0.5)*Q, A:(((k/100|0)%100)+0.5)*Q-128, B:((k%100)+0.5)*Q-128}));
  // 2) 색마다: 그 색 영역을 덩어리로 나누고, 크기가 비슷한 덩어리가 많이 반복되는지 봄
  let best=null,bs=0;
  colors.forEach(col=>{
    let m=new Uint8Array(N);
    for(let i=0;i<N;i++){const dl=(lab[i*3]-col.L)*0.5,da=lab[i*3+1]-col.A,db=lab[i*3+2]-col.B;if(dl*dl+da*da+db*db<16*16)m[i]=1}
                                        // 사진 가장자리를 많이 덮는 색 = 바닥
    m=erode(dilate(dilate(erode(m))));                 // 잡티 제거 + 글씨·반사 작은 구멍 메움
    m=fillRoundHoles(m);
    const {blobs}=label(m), cand=[];
    blobs.forEach(px=>{
      if(px.length<Math.max(20,N*0.0003)||px.length>N*0.06) return;   // 너무 작은 점(잡티)·너무 큰 면(배경) 제외
      let edge=0,sx=0,sy=0; for(const p of px){sx+=p%W;sy+=(p/W)|0;if(!m[p-1]||!m[p+1]||!m[p-W]||!m[p+W])edge++}
      const rough=edge*edge/(4*Math.PI*px.length);
      if(rough>2.6) return;                            // 들쭉날쭉한 것(반사·그림자·종이 모서리) 제외
      cand.push({px,n:px.length,cx:sx/px.length,cy:sy/px.length,rough});
    });
    cand.forEach(c=>{
      let sim=0; for(const o of cand) if(o!==c&&o.n>c.n*0.75&&o.n<c.n*1.33) sim++;
      if(sim<2) return;
      // 반복 횟수 × 크기 × 매끈함 → 약 사이 작은 빈틈(많지만 작고 오목함)보다 실제 약을 고름
      const sc=sim*Math.sqrt(c.n)/c.rough;
      if(sc>bs){bs=sc;best=c}
    });
  });
  if(!best) return null;                         // 반복되는 물체가 없으면 직접 선택으로
  // 3) 그 물체 안에서 중심에 가장 가까운 픽셀
  // 그 물체 안에서 가장 깊은 곳(테두리에서 가장 먼 점) = 그늘·반사 없는 몸체 색
  let cur=new Set(best.px), last=best.px;
  for(let it=0;it<60&&cur.size;it++){
    const nx=[]; for(const p of cur) if(cur.has(p-1)&&cur.has(p+1)&&cur.has(p-W)&&cur.has(p+W)) nx.push(p);
    if(!nx.length) break; last=nx; cur=new Set(nx);
  }
  let bp=last[0],bd=1e18; for(const p of last){const d=(p%W-best.cx)**2+(((p/W)|0)-best.cy)**2;if(d<bd){bd=d;bp=p}}
  return {x:bp%W,y:(bp/W)|0};
}

function pca(px){
  // 덩어리의 길이·폭을 방향과 무관하게 계산 (주성분 분석)
  let sx=0,sy=0,n=px.length;
  for(const p of px){sx+=p%W;sy+=(p/W)|0}
  const mx=sx/n,my=sy/n;let xx=0,yy=0,xy=0;
  for(const p of px){const dx=p%W-mx,dy=((p/W)|0)-my;xx+=dx*dx;yy+=dy*dy;xy+=dx*dy}
  xx/=n;yy/=n;xy/=n;
  const t=(xx+yy)/2,d=Math.sqrt(((xx-yy)/2)**2+xy*xy);
  return {len:4*Math.sqrt(t+d),wid:4*Math.sqrt(Math.max(0,t-d))};
}

function labelSubset(px){
  // 픽셀 목록 안에서만 이어진 조각 나누기
  const set=new Set(px), seen=new Set(), parts=[];
  for(const s0 of px){
    if(seen.has(s0))continue; const q=[s0],part=[]; seen.add(s0);
    while(q.length){const p=q.pop();part.push(p);const x=p%W;
      for(const n of [x>0?p-1:-1,x<W-1?p+1:-1,p-W,p+W]) if(n>=0&&set.has(n)&&!seen.has(n)){seen.add(n);q.push(n)}}
    parts.push(part);
  }
  return parts;
}
function label(m){
  const N=W*H,lbl=new Int32Array(N).fill(-1),blobs=[],stack=new Int32Array(N);
  for(let s=0;s<N;s++){
    if(!m[s]||lbl[s]>=0)continue;
    let sp=0;stack[sp++]=s;lbl[s]=blobs.length;const px=[];
    while(sp){const p=stack[--sp];px.push(p);const x=p%W,y=(p/W)|0;
      if(x>0&&m[p-1]&&lbl[p-1]<0){lbl[p-1]=blobs.length;stack[sp++]=p-1}
      if(x<W-1&&m[p+1]&&lbl[p+1]<0){lbl[p+1]=blobs.length;stack[sp++]=p+1}
      if(y>0&&m[p-W]&&lbl[p-W]<0){lbl[p-W]=blobs.length;stack[sp++]=p-W}
      if(y<H-1&&m[p+W]&&lbl[p+W]<0){lbl[p+W]=blobs.length;stack[sp++]=p+W}}
    blobs.push(px);
  }
  return {lbl,blobs};
}
function fillRoundHoles(m){
  // 물체 안의 '둥글고 큼직한' 빈 곳만 채움(와셔·링 부품·구멍 뚫린 정제).
  // 약 사이 틈은 뾰족하거나 무더기에 비해 아주 작아서 그대로 둠 → 붙은 약 분리를 해치지 않음
  const inv=new Uint8Array(m.length);for(let i=0;i<m.length;i++)inv[i]=m[i]?0:1;
  const holes=label(inv).blobs, objs=label(m), o=m.slice(), N=W*H;
  holes.forEach(px=>{
    if(px.length<12||px.length>N*0.05) return;
    let edge=0,border=false,owner=-1;
    for(const p of px){const x=p%W,y=(p/W)|0; if(x===0||y===0||x===W-1||y===H-1){border=true;break}
      for(const q of [p-1,p+1,p-W,p+W]) if(m[q]){edge++;owner=objs.lbl[q];break}}
    if(border||owner<0) return;
    const rough=edge*edge/(4*Math.PI*px.length);
    if(rough<1.2&&px.length>objs.blobs[owner].length*0.06) px.forEach(p=>o[p]=1);
  });
  return o;
}
function fillSmallHoles(m,maxPx){
  const inv=new Uint8Array(m.length);for(let i=0;i<m.length;i++)inv[i]=m[i]?0:1;
  const {blobs}=label(inv),o=m.slice();
  blobs.forEach(px=>{if(px.length<=maxPx)px.forEach(p=>o[p]=1)});
  return o;
}
function fillHoles(m){
  // 테두리에서 닿지 않는 빈 영역(구멍)을 채움 — 크기가 작은 구멍만
  const inv=new Uint8Array(m.length);for(let i=0;i<m.length;i++)inv[i]=m[i]?0:1;
  const {blobs}=label(inv),o=m.slice();
  blobs.forEach(px=>{if(px.length<W*H*0.002&&!px.some(p=>{const x=p%W,y=p/W|0;return x==0||y==0||x==W-1||y==H-1}))px.forEach(p=>o[p]=1)});
  return o;
}
function distT(m){
  // 3-4 chamfer 거리 변환 (단위: 픽셀)
  const d=new Float32Array(W*H);for(let i=0;i<W*H;i++)d[i]=m[i]?1e9:0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(!d[i])continue;let v=d[i];
    if(x>0)v=Math.min(v,d[i-1]+1);if(y>0){v=Math.min(v,d[i-W]+1);if(x>0)v=Math.min(v,d[i-W-1]+1.41);if(x<W-1)v=Math.min(v,d[i-W+1]+1.41)}
    if(x==0||y==0)v=Math.min(v,1);d[i]=v}
  for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){const i=y*W+x;if(!d[i])continue;let v=d[i];
    if(x<W-1)v=Math.min(v,d[i+1]+1);if(y<H-1){v=Math.min(v,d[i+W]+1);if(x<W-1)v=Math.min(v,d[i+W+1]+1.41);if(x>0)v=Math.min(v,d[i+W-1]+1.41)}
    if(x==W-1||y==H-1)v=Math.min(v,1);d[i]=v}
  return d;
}

function erode(m){const o=new Uint8Array(m.length);for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=y*W+x;o[i]=m[i]&m[i-1]&m[i+1]&m[i-W]&m[i+W]}return o}
function dilate(m){const o=new Uint8Array(m.length);for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=y*W+x;o[i]=m[i]|m[i-1]|m[i+1]|m[i-W]|m[i+W]}return o}

function kmeans(px,k){
  // 덩어리를 k개 위치로 나눔. 수백 알이 한 덩어리여도 빠르도록 점을 추려서 계산
  if(k===1){let sx=0,sy=0;for(const p of px){sx+=p%W;sy+=(p/W)|0}return[{x:sx/px.length,y:sy/px.length}]}
  const step=Math.max(1,Math.floor(px.length/Math.min(px.length,Math.max(400,k*20),6000)));
  const X=[],Y=[]; for(let i=0;i<px.length;i+=step){X.push(px[i]%W);Y.push((px[i]/W)|0)}
  const n=X.length, md=new Float64Array(n).fill(1e18), C=[];
  // 가장 먼 점부터 차례로 중심 고르기 (점마다 최소거리를 저장해 O(k·n))
  let pick=0;
  for(let c=0;c<k;c++){
    C.push({x:X[pick],y:Y[pick]});
    let far=0,fd=-1;
    for(let i=0;i<n;i++){const d=(X[i]-X[pick])**2+(Y[i]-Y[pick])**2;if(d<md[i])md[i]=d;if(md[i]>fd){fd=md[i];far=i}}
    pick=far;
  }
  const sx=new Float64Array(k),sy=new Float64Array(k),cn=new Int32Array(k);
  for(let it=0;it<8;it++){
    sx.fill(0);sy.fill(0);cn.fill(0);
    for(let i=0;i<n;i++){let bi=0,bd=1e18;for(let j=0;j<k;j++){const d=(X[i]-C[j].x)**2+(Y[i]-C[j].y)**2;if(d<bd){bd=d;bi=j}}sx[bi]+=X[i];sy[bi]+=Y[i];cn[bi]++}
    for(let j=0;j<k;j++) if(cn[j]) C[j]={x:sx[j]/cn[j],y:sy[j]/cn[j]};
  }
  return C;
}


/* ---------- 작업 요청 처리 ---------- */
self.onmessage=e=>{
  const m=e.data;
  try{
    W=m.w; H=m.h; TOL=m.tol; HINT=m.hint||null;
    photo={data:new Uint8ClampedArray(m.buf)}; lab=toLab(photo.data);
    let s=m.seed;
    if(m.auto||!s) s=autoSeed();
    if(!s){ self.postMessage({id:m.id,none:true}); return; }
    seed=s;
    const r=count();
    const counted=r.pts.filter(p=>p.type!=='제외').length;
    // 자동 모드 검증: 기준과 똑같은 모습의 물체가 3개 이상이고, 주변과 뚜렷이 달라야 '약'으로 인정
    self.lastCheck={counted,singles:r.singles,contrast:r.contrast};
    if(m.auto&&(counted<2||(r.singles||0)<3||(r.contrast||0)<14)){ self.postMessage({id:m.id,none:true,check:self.lastCheck}); return; }
    self.postMessage({id:m.id,seed:s,pts:r.pts,stat:r.stat||{},r:r.r,mask:r.mask},[r.mask.buffer]);
  }catch(err){ self.postMessage({id:m.id,none:true,error:String(err)}); }
};
