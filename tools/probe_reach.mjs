import { SIZE, NCELL, cellAt } from "../src/solver.js";

// 最小限の実験用ソルバー（reach K 可変）
function geomOf(walls, K){
  const W = new Uint8Array(NCELL);
  for (const w of walls) W[w]=1;
  const reach = new Int32Array(NCELL);
  const plus = new Int32Array(NCELL);
  for(let i=0;i<NCELL;i++){
    const r=Math.floor(i/SIZE), c=i%SIZE;
    let p=1<<i;
    for(const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]){
      const nr=r+dr,nc=c+dc; if(nr<0||nr>=5||nc<0||nc>=5)continue;
      const j=nr*SIZE+nc; if(W[j])continue; p|=1<<j;
    }
    plus[i]=p;
    // BFS depth K
    let front=1<<i, seen=1<<i;
    for(let s=0;s<K;s++){
      let nxt=0;
      for(let b=0;b<NCELL;b++) if((front>>b)&1){
        const rr=Math.floor(b/5), cc=b%5;
        for(const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]){
          const nr=rr+dr,nc=cc+dc; if(nr<0||nr>=5||nc<0||nc>=5)continue;
          const j=nr*5+nc; if(W[j])continue; if((seen>>j)&1)continue; nxt|=1<<j;
        }
      }
      seen|=nxt; front=nxt;
    }
    reach[i]=seen;
  }
  return {W,plus,reach};
}
function solve(traps,pos,g,limit){
  const memo=new Map();
  const cells=[]; for(let i=0;i<NCELL;i++) if(!g.W[i]) cells.push(i);
  function d(t,p,depth){
    const opts=(g.reach[p]&~t)>>>0;
    if(opts===0) return 0;
    if(depth===0) return Infinity;
    const key=(t*32+p)*16+depth;
    if(memo.has(key)) return memo.get(key);
    let best=Infinity;
    for(const cell of cells){
      if(cell===p) continue;
      const t2=(t^g.plus[cell])>>>0;
      const o2=(g.reach[p]&~t2)>>>0;
      if(o2===0){ best=1; break; }
      let worst=0, ok=true;
      for(let b=0;b<NCELL;b++) if((o2>>b)&1){
        const dd=d(t2,b,depth-1);
        if(!isFinite(dd)){ok=false;break;}
        if(dd+1>worst)worst=dd+1;
      }
      if(ok&&worst<best)best=worst;
    }
    memo.set(key,best);
    return best;
  }
  const r=d(traps,pos,limit);
  return isFinite(r)?r:null;
}
let s0=99; const rng=()=>{s0=(s0*1664525+1013904223)>>>0; return s0/4294967296;};
for(const K of [1,2]){
  for(const [nW,nT] of [[0,0],[3,5],[5,7],[8,8]]){
    const hist={}; let t0=Date.now(); let n=0;
    for(let i=0;i<40;i++){
      const pool=[...Array(25).keys()].sort(()=>rng()-0.5);
      const walls=pool.slice(0,nW), tanuki=pool[nW], traps=pool.slice(nW+1,nW+1+nT);
      const g=geomOf(walls,K);
      let t=0; for(const c of traps) t|=1<<c;
      if(((g.reach[tanuki]&~t)>>>0)===0) continue;
      n++;
      const r=solve(t,tanuki,g,5);
      const d=r===null?0:r; hist[d]=(hist[d]||0)+1;
    }
    console.log('K='+K, `W${nW}/T${nT}`, 'n='+n, 'ms='+(Date.now()-t0), JSON.stringify(hist));
  }
}
