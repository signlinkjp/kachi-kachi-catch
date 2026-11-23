const SIZE=5,NCELL=25;
function geomOf(walls, diag){
  const W=new Uint8Array(NCELL); for(const w of walls) W[w]=1;
  const reach=new Int32Array(NCELL), plus=new Int32Array(NCELL);
  const dirs=[[-1,0],[1,0],[0,-1],[0,1]].concat(diag?[[-1,-1],[-1,1],[1,-1],[1,1]]:[]);
  for(let i=0;i<NCELL;i++){
    const r=Math.floor(i/SIZE),c=i%SIZE;
    let p=1<<i, m=1<<i;
    for(const [dr,dc] of dirs){ const nr=r+dr,nc=c+dc; if(nr<0||nr>=5||nc<0||nc>=5)continue; const j=nr*5+nc; if(W[j])continue; m|=1<<j; if(Math.abs(dr)+Math.abs(dc)===1) p|=1<<j; }
    plus[i]=p; reach[i]=m;
  }
  return {W,plus,reach};
}
function solve(traps,pos,g,limit){
  const memo=new Map(); const cells=[]; for(let i=0;i<NCELL;i++) if(!g.W[i]) cells.push(i);
  function d(t,p,depth){
    const opts=(g.reach[p]&~t)>>>0; if(opts===0) return 0; if(depth===0) return Infinity;
    const key=(t*32+p)*16+depth; if(memo.has(key)) return memo.get(key);
    let best=Infinity;
    for(const cell of cells){
      const t2=(t^g.plus[cell])>>>0; const o2=(g.reach[p]&~t2)>>>0;
      if(o2===0){ best=1; break; }
      let worst=0,ok=true;
      for(let b=0;b<NCELL;b++) if((o2>>b)&1){ const dd=d(t2,b,depth-1); if(!isFinite(dd)){ok=false;break;} if(dd+1>worst)worst=dd+1; }
      if(ok&&worst<best)best=worst;
    }
    memo.set(key,best); return best;
  }
  const r=d(traps,pos,limit); return isFinite(r)?r:null;
}
let s0=99; const rng=()=>{s0=(s0*1664525+1013904223)>>>0; return s0/4294967296;};
for(const diag of [true]){
 for(const [nW,nT] of [[0,0],[2,3],[4,5],[6,7]]){
  const hist={}; let t0=Date.now(), n=0;
  for(let i=0;i<8;i++){
    const pool=[...Array(25).keys()].sort(()=>rng()-0.5);
    const walls=pool.slice(0,nW), tanuki=pool[nW], traps=pool.slice(nW+1,nW+1+nT);
    const g=geomOf(walls,diag);
    let t=0; for(const c of traps) t|=1<<c;
    if(((g.reach[tanuki]&~t)>>>0)===0) continue;
    n++; const r=solve(t,tanuki,g,7); const dd=r===null?0:r; hist[dd]=(hist[dd]||0)+1;
  }
  console.log('diag='+diag,`W${nW}/T${nT}`,'n='+n,'ms='+(Date.now()-t0),JSON.stringify(hist));
 }
}
