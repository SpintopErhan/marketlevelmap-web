import json,urllib.request,time
URL="https://base-rpc.publicnode.com"
def call(method,params,retries=5):
    body=json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params}).encode()
    for i in range(retries):
        try:
            r=urllib.request.urlopen(urllib.request.Request(URL,body,{"Content-Type":"application/json","User-Agent":"onchain-candles-test/0.1"}),timeout=60)
            d=json.load(r)
            if "error" in d: raise RuntimeError(d["error"])
            return d["result"]
        except urllib.error.HTTPError as e:
            if e.code in (429,500,502,503,504): time.sleep(2*(i+1)); continue
            raise
    raise RuntimeError("retries")
def ecall(to,data,block="latest"): return call("eth_call",[{"to":to,"data":data},block])
