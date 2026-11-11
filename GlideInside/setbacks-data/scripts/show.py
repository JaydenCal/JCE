import json,sys
for slug in sys.argv[2:]:
    d=json.load(open('rules/%s.json'%slug)); print('#####',slug,d['status'],len(d['rules']))
    n=int(sys.argv[1])
    for r in d['rules'][:n]:
        v=lambda k:(None if not r[k] else (r[k]['minM'] if r[k]['minM'] is not None else r[k].get('basis')))
        print(r['id'][-3:],r['zones'],r['appliesTo'],r['conditions'],'F',v('front'),'SF',v('secondaryFront'),'S',v('side'),'R',v('rear'),'G',r['garage'] and r['garage'].get('minM'),'|',str(r['conditionText'])[:110],'|',r['confidence'])
