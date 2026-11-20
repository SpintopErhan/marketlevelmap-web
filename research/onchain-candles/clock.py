# Block → time on Base from real block headers: anchors every STEP blocks, linear in between.
import sys,json,os,bisect;sys.path.insert(0,os.path.dirname(__file__))
from rpc import *
STEP=200000
def bts(n):return int(call("eth_getBlockByNumber",[hex(n),False])["timestamp"],16)
class Clock:
    def __init__(s,first,last,path="anchors.json"):
        s.a=json.load(open(path)) if os.path.exists(path) else {}
        s.a={int(k):v for k,v in s.a.items()}
        import concurrent.futures as F
        need=[n for n in list(range(first//STEP*STEP,last,STEP))+[last] if n not in s.a]
        with F.ThreadPoolExecutor(6) as ex:
            for n,t in zip(need,ex.map(bts,need)):s.a[n]=t
        json.dump(s.a,open(path,"w"));s.k=sorted(s.a)
    def ts(s,n):
        i=bisect.bisect_right(s.k,n)-1;i=max(0,min(i,len(s.k)-2));a,b=s.k[i],s.k[i+1]
        return s.a[a]+(s.a[b]-s.a[a])*(n-a)/(b-a)
    def block(s,t):
        lo,hi=s.k[0],s.k[-1]
        while lo<hi:
            m=(lo+hi)//2
            if s.ts(m)<t:lo=m+1
            else:hi=m
        return lo
