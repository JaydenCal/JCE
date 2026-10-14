#!/usr/bin/env python3
"""Install a Plan Studio build as the Pocket Architect app.
Usage: python3 tools/install_app.py path/to/plan-studio_N.html
Applies the site patches to a COPY and writes site/plan-studio/app/index.html. Re-run for every new build."""
import sys,re,pathlib
src=pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
P=[('premiumEnabled:!1,planPack:{','premiumEnabled:!0,planPack:{',1),        # turn paid features on
   ('priceAud:30','priceAud:35',1),('priceAud??30','priceAud??35',None),('??30)','??35)',None),   # A$35 per job
   ('links:{engineering:"",flythrough:"",terms:"",privacy:""}','links:{engineering:"mailto:hello@glideinside.com.au",flythrough:"../index.html#addons",terms:"../../terms.html",privacy:"../../privacy.html"}',1),
   ('Plan Studio','Pocket Architect',None)]
for a,b,n in P:
    c=src.count(a)
    if c==0: print('WARNING pattern not found:',a); continue
    if n and c!=n: print('WARNING',a,'found',c,'times, expected',n)
    src=src.replace(a,b)
out=pathlib.Path(__file__).resolve().parent.parent/'site/plan-studio/app/index.html'
out.parent.mkdir(parents=True,exist_ok=True); out.write_text(src,encoding='utf-8'); print('wrote',out,len(src),'bytes')
