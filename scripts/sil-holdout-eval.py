import json, random, urllib.request, collections, sys
URL="https://converse-spine-dev.nagarjun-arjun.workers.dev/api/sil/probe"
rows=[]
for line in open('corpus/intent-registry.jsonl'):
    line=line.strip()
    if not line: continue
    try: r=json.loads(line)
    except: continue
    if r.get('eval_split')!='holdout': continue
    if r.get('quarantine') or r.get('is_negative'): continue
    if not r.get('routable'): continue
    p=(r.get('phrasing') or '').strip()
    k=r.get('intent_kind')
    if p and k: rows.append((p,k))
random.seed(7); random.shuffle(rows)
N=int(sys.argv[1]) if len(sys.argv)>1 else 400
rows=rows[:N]
print(f"holdout rows (routable, clean): {len(rows)} sampled")
res=[]
B=25
for i in range(0,len(rows),B):
    batch=rows[i:i+B]
    body=json.dumps({"builder_id":"naya-advisor","items":[{"text":p,"expected":k} for p,k in batch]}).encode()
    req=urllib.request.Request(URL,data=body,headers={'Content-Type':'application/json','User-Agent':'Mozilla/5.0','Origin':'https://naya-advisor-dev.pages.dev'})
    try:
        with urllib.request.urlopen(req,timeout=120) as f:
            res.extend(json.load(f).get('results',[]))
    except Exception as e:
        print("  batch fail",i,e)
    print(f"  {min(i+B,len(rows))}/{len(rows)}",end='\r')
print()
json.dump(res,open('/tmp/sil_eval_results.json','w'))
print("collected:",len(res))
