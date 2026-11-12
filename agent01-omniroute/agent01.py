#!/usr/bin/env python3
"""Guarded OmniRoute client for Agent 01."""
import argparse,json,os,sys,ipaddress,urllib.parse,urllib.request
SYSTEM="""You are Agent 01 Original Boss. Use Superpowers-style planning, TDD, debugging, review, and actual verification. Prioritize SmartServe, OMEGA X, Share App, MDGx1, Shadowbound. Do not invent integrations, tests, revenue or deployments. Never spend or publish without approval."""
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        raise ValueError("Redirects are disabled")
def validate_url(url):
    u=urllib.parse.urlsplit(url)
    if not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ("","/","/v1"):
        raise ValueError("Invalid OmniRoute base URL")
    try: ip=ipaddress.ip_address(u.hostname)
    except ValueError: ip=None
    local=u.hostname=="localhost" or (ip is not None and ip.is_loopback)
    if u.scheme!="https" and not (u.scheme=="http" and local):
        raise ValueError("Remote endpoint must use HTTPS")
    if ip is not None and not local and not ip.is_global:
        raise ValueError("Non-public remote endpoint rejected")
    return url.rstrip("/").removesuffix("/v1")
def request_json(base,key,path,payload=None):
    base=validate_url(base)
    if not key: raise ValueError("OMNIROUTE_API_KEY required")
    if path not in ("/v1/models","/v1/chat/completions"): raise ValueError("Endpoint not allowed")
    data=None if payload is None else json.dumps(payload).encode()
    req=urllib.request.Request(base+path,data=data,headers={"Authorization":"Bearer "+key,"Accept":"application/json","Content-Type":"application/json"},method="GET" if data is None else "POST")
    with urllib.request.build_opener(NoRedirect()).open(req,timeout=20) as response:
        if response.status!=200: raise ValueError("Gateway error")
        return json.loads(response.read(512000))
def probe(base,key):
    result=request_json(base,key,"/v1/models")
    return {"connected":True,"models":len(result.get("data",[]))}
def run_task(base,key,task,model="auto"):
    if not task.strip() or len(task)>12000: raise ValueError("Invalid task length")
    result=request_json(base,key,"/v1/chat/completions",{"model":model,"messages":[{"role":"system","content":SYSTEM},{"role":"user","content":task}],"stream":False})
    return result["choices"][0]["message"]["content"]
def main():
    p=argparse.ArgumentParser()
    p.add_argument("command",choices=["probe","run"])
    p.add_argument("task",nargs="?",default="Create the next concrete project plan with acceptance checks")
    args=p.parse_args()
    base=os.getenv("OMNIROUTE_BASE_URL","http://127.0.0.1:20128")
    key=os.getenv("OMNIROUTE_API_KEY","")
    try:
        result=probe(base,key) if args.command=="probe" else run_task(base,key,args.task,os.getenv("OMNIROUTE_MODEL","auto"))
        print(json.dumps(result,indent=2) if isinstance(result,dict) else result)
    except Exception as exc:
        print("Agent 01: "+str(exc).replace(key,"[REDACTED]") if key else "Agent 01: "+str(exc),file=sys.stderr)
        return 1
    return 0
if __name__=="__main__": sys.exit(main())
