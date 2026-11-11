import json,sys,random
random.seed(int(sys.argv[1]))
for slug in sys.argv[2:]:
    d=json.load(open('rules/%s.json'%slug)); print('#####',slug,d['status'])
    rs=random.sample(d['rules'],min(4,len(d['rules'])))
    for r in rs:
        for e in r['evidence'][:2]:
            sl=e['slot']; v=r[sl] if sl in r and r[sl] else (r['garage'] if sl.startswith('garage') else None)
            print(' ',r['id'][-3:],r['zones'],r['appliesTo'],{k:x for k,x in r['conditions'].items()},sl,v and (v.get('minM'),v.get('basis')),'||',e['condition'][:100],'||',e['quote'][:90])
