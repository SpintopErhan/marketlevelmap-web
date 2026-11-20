# Fetch every swap of NVDAc/USDC pools on Base from the public RPC and save them as JSON lines.
import sys,json,datetime as D,concurrent.futures as F;sys.path.insert(0,".")
from rpc import *
from clock import Clock
OLDEST=51150000   # the free RPC serves blocks from about 7 Sep 2026
V3="0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
V4="0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"
PM="0x498581ff718922c3f8e6a244956af099b2652b2b"
POOLS=[("aero-slipstream-new","0xf668e21993f0acd7ab00bb1cfbaed0df28a3c8ec","2026-10-22T02:50:49Z",None),
       ("aero-slipstream-old","0x853f5f1b92b16714fe6cda67caad0856b83c7ab9","2026-08-12T19:31:01Z",None),
       ("uniswap-v3","0x60661b315553eb81872deea9a66d567cf0ccd33b","2026-08-18T16:11:19Z",None),
       ("nami","0x337bea70489cd71a8c3951c1aa49c637b4b9b122","2026-11-13T06:25:55Z",None),
       ("uniswap-v4",PM,"2026-11-02T04:38:55Z","0xc8c52ec416fe9d3b6e70a2e4ccde7cece3b8318d109a1aa1bbc7e0980c4fe985")]
def sint(h):v=int(h,16);return v-(1<<256) if v>=1<<255 else v
def job(args):
    name,addr,a,b,pid=args
    q={"address":addr,"fromBlock":hex(a),"toBlock":hex(b),"topics":[V4,pid] if pid else [V3]}
    out=[]
    try: logs=call("eth_getLogs",[q],retries=3)
    except Exception:
        if b-a<500: raise
        m=(a+b)//2;return job((name,addr,a,m,pid))+job((name,addr,m+1,b,pid))
    for l in logs:
        d=l["data"][2:];w=[d[i:i+64] for i in range(0,len(d),64)]
        a0,a1=sint(w[0]),sint(w[1])          # USDC (6 dec), NVDAc (8 dec); pool's view (+ = into pool). v4 is the swapper's view.
        if pid:a0,a1=-a0,-a1
        if a0==0 or a1==0:continue
        usd=abs(a0)/1e6;qty=abs(a1)/1e8
        out.append({"t":int(ts(int(l["blockNumber"],16))),"b":int(l["blockNumber"],16),"i":int(l["logIndex"],16),"pool":name,"usd":usd,"qty":qty,"px":usd/qty,"buy":a1<0,"tx":l["transactionHash"]})
    return out
end=int(call("eth_blockNumber",[]),16);STEP=50000
C=Clock(OLDEST,end);ts=C.ts
blk=lambda iso:max(OLDEST,C.block(D.datetime.fromisoformat(iso.replace("Z","+00:00")).timestamp()))
jobs=[(n,a,s,min(s+STEP-1,end),pid) for n,a,c,pid in POOLS for s in range(blk(c)-100,end+1,STEP)]
print(len(jobs),"requests",file=sys.stderr)
rows=[]
with F.ThreadPoolExecutor(4) as ex:
    for r in ex.map(job,jobs):rows+=r
rows.sort(key=lambda r:(r["b"],r["i"]))
with open("swaps.jsonl","w") as f:
    for r in rows:f.write(json.dumps(r)+"\n")
print(len(rows),"swaps, last block",end,file=sys.stderr)
