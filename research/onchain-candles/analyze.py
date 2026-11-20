import json,collections,statistics as S,datetime as D
R=[json.loads(l) for l in open("swaps.jsonl")]
u=lambda s:D.datetime.fromtimestamp(s,D.UTC)
print("== pools")
for p,g in sorted(collections.defaultdict(list,{k:[r for r in R if r["pool"]==k] for k in {r["pool"] for r in R}}).items()):
    print(f"  {p:22s} swaps {len(g):6d}  vol ${sum(r['usd'] for r in g)/1e6:8.1f}M  {u(g[0]['t']):%Y-%m-%d} → {u(g[-1]['t']):%Y-%m-%d}  median px {S.median(r['px'] for r in g):.2f}")
sizes=sorted(r["usd"] for r in R)
q=lambda p:sizes[int(p*(len(sizes)-1))]
print("== trade size $: p10 %.2f p50 %.0f p90 %.0f p99 %.0f max %.0f"%(q(.1),q(.5),q(.9),q(.99),sizes[-1]))
print("   share of swaps under $10: %.1f%%, under $100: %.1f%%; their volume share: %.2f%%"%(100*sum(s<10 for s in sizes)/len(sizes),100*sum(s<100 for s in sizes)/len(sizes),100*sum(s for s in sizes if s<100)/sum(sizes)))
def candles(rows,minusd=0):
    H={}
    for r in rows:
        h=r["t"]//3600*3600;c=H.get(h)
        if c is None:c=H[h]={"o":None,"h":None,"l":None,"c":None,"v":0}
        c["v"]+=r["usd"]
        if r["usd"]<minusd:continue
        if c["o"] is None:c["o"]=r["px"]
        c["c"]=r["px"];c["h"]=max(c["h"] or 0,r["px"]);c["l"]=min(c["l"] or 1e18,r["px"])
    return {h:c for h,c in H.items() if c["o"] is not None}
# 1) decoding check vs GeckoTerminal (main pool only)
import os
GT="gt_main_pool_1h.json"   # optional: GeckoTerminal /pools/<main pool>/ohlcv/hour?limit=1000 saved here
gt={r[0]:r for r in json.load(open(GT))["data"]["attributes"]["ohlcv_list"]} if os.path.exists(GT) else {}
mine=candles([r for r in R if r["pool"]=="aero-slipstream-new"])
common=sorted(set(gt)&set(mine))[:-1]
if common:
 dev=lambda k,i:[abs(mine[h][k]/gt[h][i]-1)*100 for h in common]
 print("== check vs GeckoTerminal, main pool, %d common hours: median |diff| %% close %.4f high %.4f low %.4f, max close %.3f; volume ratio %.3f"%(len(common),S.median(dev("c",4)),S.median(dev("h",2)),S.median(dev("l",3)),max(dev("c",4)),sum(mine[h]["v"] for h in common)/sum(gt[h][5] for h in common)))
# 2) wick size with all pools merged, by market session, raw vs ignoring small trades
def sess(h):
    d=u(h)
    if d.weekday()>=5:return "weekend"
    m=d.hour*60+d.minute
    return "US open" if 13*60+30<=m<20*60 else "weekday closed"   # NYSE 9:30–16:00 ET = 14:30–21:00 UTC in winter, 13:30–20:00 in summer (approx.)
print("== hourly range (high-low)/close %, all pools merged")
for th in (0,10,100,1000):
    C=candles(R,th);by=collections.defaultdict(list)
    for h,c in C.items():by[sess(h)].append((c["h"]-c["l"])/c["c"]*100)
    print("   ignore trades < $%-5d"%th,"  ".join(f"{k}: median {S.median(v):.2f} p90 {sorted(v)[int(.9*len(v))]:.2f}" for k,v in sorted(by.items())),f" hours {len(C)}")
# 3) price disagreement between pools in the same minute
bym=collections.defaultdict(dict)
for r in R:
    if r["usd"]>=100:bym[r["t"]//60][r["pool"]]=r["px"]
sp=[(max(v.values())/min(v.values())-1)*100 for v in bym.values() if len(v)>1]
print("== same-minute price gap between pools (trades ≥$100): minutes %d, median %.3f%%, p90 %.3f%%"%(len(sp),S.median(sp),sorted(sp)[int(.9*len(sp))]))
# 4) hours with no trade at all, all pools, since main trading began (24 Aug)
C=candles(R);start=int(D.datetime(2026,9,8,tzinfo=D.UTC).timestamp());hrs=range(start,max(C)+1,3600)
print("== hours without any trade since 8 Sep: %d of %d"%(sum(h not in C for h in hrs),len(hrs)))
vol=collections.defaultdict(float)
for r in R:
    if r["t"]>=start:vol[sess(r["t"]//3600*3600)]+=r["usd"]
n=collections.Counter(sess(h) for h in hrs)
print("== avg $ volume per hour:","  ".join(f"{k}: {vol[k]/n[k]:,.0f}" for k in sorted(n)))
json.dump({str(h):c for h,c in C.items()},open("candles_raw.json","w"))
