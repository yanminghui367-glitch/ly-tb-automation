"""Read-only local five-stage timing summary. No browser, network or DB access."""
import argparse,json,math
from pathlib import Path
from collections import defaultdict

STAGES=('upload-entry','upload-panel','upload-receipt','thumbnail','detail-panel')
def percentile(values,p):
    return sorted(values)[math.ceil(len(values)*p)-1] if values else None
def summary(rows):
    success=[x['durationMs'] for x in rows if x.get('status')=='ready']
    failed=[x['durationMs'] for x in rows if x.get('status')!='ready']
    return {'observations':len(rows),'ready':len(success),'failedOrInterrupted':len(failed),'readyP50Ms':percentile(success,.5),'readyP90Ms':percentile(success,.9),'failedDurationsMs':failed,'timeoutBudgetsMs':sorted({x['timeoutMs'] for x in rows if isinstance(x.get('timeoutMs'),(int,float))})}
def collect(roots):
    groups=defaultdict(list);selectors=defaultdict(list);seen=set();invalid=[];files=[]
    for root in roots:
        for p in sorted(root.rglob('detail-readiness-*.json')):
            p=p.resolve()
            if p in seen:continue
            seen.add(p)
            try:
                row=json.loads(p.read_text(encoding='utf-8-sig'))
                if row.get('stage') not in STAGES or not isinstance(row.get('durationMs'),(int,float)) or isinstance(row['durationMs'],bool) or not math.isfinite(row['durationMs']) or row['durationMs']<0:raise ValueError('invalid stage or duration')
            except (OSError,ValueError,TypeError) as error:invalid.append({'file':str(p),'reason':str(error)});continue
            groups[row['stage']].append(row);selectors[(row['stage'],row.get('selector',''))].append(row);files.append(str(p))
    return {'scope':'Only supplied task artifact directories; no inferred zero-duration samples','method':'nearest-rank; percentiles use ready observations only; failures/timeouts listed separately','caution':'Small samples are descriptive. Missing stages mean not observed, not zero. Upload-panel contains two selectors; inspect breakdown before comparing budgets. Repeated retries are separate observations.','files':files,'invalid':invalid,'stages':{s:summary(groups[s]) for s in STAGES},'selectorBreakdown':[{'stage':s,'selector':selector,**summary(rows)} for (s,selector),rows in sorted(selectors.items())]}
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('task_directories',nargs='+',type=Path)
    args=parser.parse_args()
    for root in args.task_directories:
        if not root.is_dir():parser.error('task directory not found: '+str(root))
    print(json.dumps(collect(args.task_directories),ensure_ascii=False,indent=2))
