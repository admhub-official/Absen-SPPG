import re
from collections import Counter
p='d:/Absen-SPPG/index.html'
with open(p,encoding='utf-8') as f:
    s=f.read()
lines=s.splitlines()
print('Lines:',len(lines))
print('Double quotes:',s.count('"'))
print("Single quotes:",s.count("'"))
# find inline handlers
handlers=[]
for i,l in enumerate(lines,1):
    if re.search(r"\bon(click|change|input|submit|dblclick|keypress|onkeydown|onkeyup)\b", l):
        handlers.append((i,l.strip()))
print('\nFound inline event handler lines:',len(handlers))
for i,l in handlers[:200]:
    print(i, l)
# duplicates ids
ids=re.findall(r'id\s*=\s*"([^"]+)"', s)
dups=[k for k,v in Counter(ids).items() if v>1]
print('\nTotal ids:',len(ids),'duplicates count:',len(dups))
if dups:
    print('Duplicates sample:',dups[:50])
# risky patterns
risk = re.findall(r"\$\{escapeHtml\(|\$\{.*?\}", s)
print('\nPotential ${...} template occurrences:', len(risk))
# long lines
longs=sorted(enumerate(lines,1), key=lambda x: len(x[1]), reverse=True)
print('\nTop 5 longest lines (line, len):')
for i,l in longs[:5]:
    print(i,len(l))
    print(l[:300])
