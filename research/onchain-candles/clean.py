# Outlier rule: a trade does not set high/low when it is more than MAXDEV away from the median price of the
# surrounding N trades of at least MINREF dollars (a real move shifts that median; a lone odd print does not).
import json,bisect,statistics as S,collections,datetime as D
MAXDEV,N,MINREF=0.015,20,100
R=[json.loads(l) for l in open("swaps.jsonl")]
big=[r for r in R if r["usd"]>=MINREF];bt=[(r["b"],r["i"]) for r in big]
def ref(r):
    i=bisect.bisect_left(bt,(r["b"],r["i"]));w=big[max(0,i-N//2):i+N//2]
    return S.median(x["px"] for x in w)
keep=[];drop=0
for r in R:
    if abs(r["px"]/ref(r)-1)>MAXDEV:drop+=1
    else:keep.append(r)
print(f"dropped {drop} of {len(R)} trades ({100*drop/len(R):.3f}%), volume ${sum(r['usd'] for r in R)-sum(r['usd'] for r in keep):,.0f}")
json.dump(keep,open("swaps_clean.json","w"))
