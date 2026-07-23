import json, collections
res=json.load(open('/tmp/sil_eval_results.json'))
res=[r for r in res if r.get('expected')]
n=len(res)
TAU=0.78
correct=sum(1 for r in res if r.get('top_kind')==r['expected'])
conf=[r for r in res if (r.get('top_score') or 0)>=TAU]
conf_correct=sum(1 for r in conf if r.get('top_kind')==r['expected'])
below=[r for r in res if (r.get('top_score') or 0)<TAU]
print(f"n = {n}   (held-out rows, never embedded)")
print(f"top-1 accuracy (all)        : {correct}/{n} = {correct/n*100:.1f}%")
print(f"coverage at tau>=0.78       : {len(conf)}/{n} = {len(conf)/n*100:.1f}%")
if conf: print(f"accuracy WHEN confident     : {conf_correct}/{len(conf)} = {conf_correct/len(conf)*100:.1f}%")
if below:
    bc=sum(1 for r in below if r.get('top_kind')==r['expected'])
    print(f"accuracy below tau          : {bc}/{len(below)} = {bc/len(below)*100:.1f}%  (these would go to clarify)")
scores=sorted((r.get('top_score') or 0) for r in res)
def pct(p): return scores[int(len(scores)*p)] if scores else 0
print(f"score distribution          : p10={pct(.1):.3f} p50={pct(.5):.3f} p90={pct(.9):.3f} max={scores[-1]:.3f}")
print(f"  (near-1.0 mass would mean leakage; expect < ~0.95)")
mr=collections.Counter(r.get('miss_reason') for r in res if r.get('miss_reason'))
if mr: print("miss_reasons                :", dict(mr))
print("\nWORST intents (>=6 samples):")
per=collections.defaultdict(lambda:[0,0])
for r in res:
    e=r['expected']; per[e][1]+=1
    if r.get('top_kind')==e: per[e][0]+=1
rows=[(c/t, c, t, k) for k,(c,t) in per.items() if t>=6]
for acc,c,t,k in sorted(rows)[:8]:
    print(f"   {acc*100:5.1f}%  {c:3}/{t:<3} {k}")
print("\nTOP confusions:")
conf_pairs=collections.Counter((r['expected'], r.get('top_kind')) for r in res if r.get('top_kind') and r.get('top_kind')!=r['expected'])
for (e,g),c in conf_pairs.most_common(8): print(f"   {c:3}x  {e}  ->  {g}")
