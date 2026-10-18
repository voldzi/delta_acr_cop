"""Root custody for the explicitly retired measurement report cron.
No scheduler edits, marker creation, SQL, key provisioning or report writes.
The historical retirement must bind to Root receipts; live producer sources and
processes must remain clear for every admission assertion. Report file contents
are deliberately not part of the producer digest: the admitted reset owns them.
"""
import hashlib,json,os,re,socket,stat,subprocess
from pathlib import Path
ROOT=Path('/srv/x5-production/staging/cop/clean-operator-shared-v3')
RECEIPTS=Path('/srv/sim/.sim-erasure-cutover')
REPORT_DIRECTORY='/srv/x5-production/cache/csm-sim/driver-measurement-reports'
SOURCE='ca1fd6b6046745e91cca6648e1e5bd3f93fc8422'
CRON_SHA='c46a03b13ee8d39860fb7bd72df740006f8762fd421ded44e1b2cac990d15d78'
ORIGINAL='12e5f824e2aa9f8f740cc4fded7589743902243c0ba641c943b14ab4054ec705'
SCHEDULERS=['/etc/crontab','/etc/cron.d','/var/spool/cron/crontabs','/etc/systemd/system','/usr/lib/systemd/system']
PATTERN=re.compile(rb'driver[-_]measurement|driver-measurement-reports|/internal/driver-measurements/v1/(?:aggregates|quality)',re.I)
ENV={'PATH':'/usr/bin:/bin','HOME':'/root','LANG':'C'}
NODE="""import {reportInventory} from '/srv/x5-production/staging/cop/clean-operator-shared-v3/sim/scripts/driver-report-inventory.mjs';
try { process.stdout.write(JSON.stringify(reportInventory())); }
catch { process.stderr.write('RESET_RETIRED_CURRENT_INVENTORY_UNAVAILABLE');process.exitCode=1; }
"""
def need(value,code):
 if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def root_read(path,modes=(0o600,),limit=16*1024*1024):
 path=Path(path);need(path.resolve()==path,'RESET_RETIRED_PATH_SYMLINK')
 parent=path.parent.lstat();need(stat.S_ISDIR(parent.st_mode)and parent.st_uid==0 and not parent.st_mode&0o022,'RESET_RETIRED_PARENT_CUSTODY')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and s.st_uid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)in modes and s.st_size<=limit,'RESET_RETIRED_FILE_CUSTODY')
  raw=os.read(fd,limit+1);t=os.fstat(fd);p=path.lstat()
  identity=lambda v:(v.st_dev,v.st_ino,v.st_size,v.st_mtime_ns,v.st_ctime_ns)
  need(len(raw)==s.st_size and identity(s)==identity(t)==identity(p),'RESET_RETIRED_FILE_CHANGED');return raw
 finally:os.close(fd)
def historical_counts(value):
 need(isinstance(value,dict)and value.get('contractVersion')=='sim-driver-report-inventory-v1','RESET_RETIRED_HISTORY_SCHEMA')
 need(all(type(value.get(k))is int and value[k]==0 for k in ['fileCount','bytes','activeProducerCount'])and value.get('producerMatches')==[] and value.get('lockPresent')is False and re.fullmatch('[a-f0-9]{64}',value.get('inventoryDigest','')),'RESET_RETIRED_HISTORY_NOT_CLEAR')
 return value['inventoryDigest']
def retirement_digest():
 d=RECEIPTS.lstat();need(stat.S_ISDIR(d.st_mode)and(d.st_uid,d.st_gid,stat.S_IMODE(d.st_mode))==(0,0,0o700),'RESET_RETIRED_RECEIPT_DIRECTORY')
 raw={name:root_read(RECEIPTS/name)for name in ['post-stop-inventory.json','inventory-transition.json','runtime-plan.json']}
 post=json.loads(raw['post-stop-inventory.json']);transition=json.loads(raw['inventory-transition.json'])
 need(post.get('sourceRevision')==transition.get('sourceRevision')==SOURCE,'RESET_RETIRED_SOURCE_BINDING')
 need(post.get('retiredCronSha256')==transition.get('expectedRetiredCronSha256')==CRON_SHA,'RESET_RETIRED_CRON_BINDING')
 need(post.get('originalInventoryDigest')==transition.get('original',{}).get('inventoryDigest')==ORIGINAL,'RESET_RETIRED_ORIGINAL_BINDING')
 need(post.get('legacyCleanupRetired')is True and post.get('otherProducerSourcesUnchanged')is True and transition.get('otherProducerSourcesUnchanged')is True and post.get('databaseContacted')is False and post.get('erasureEnabled')is False,'RESET_RETIRED_SCOPE_BINDING')
 need(historical_counts(post.get('reportInventory'))==historical_counts(transition.get('resulting')),'RESET_RETIRED_HISTORY_BINDING')
 return sha(encoded({name:sha(value)for name,value in raw.items()}))
def scheduler_digest():
 """Same fixed source roots and pattern as sealed SIM reportInventory()."""
 scanned=[];matches=[]
 def scan(path,depth=0):
  need(depth<=8 and len(scanned)<=10000,'RESET_RETIRED_SCHEDULER_LIMIT')
  try:s=path.lstat()
  except FileNotFoundError:return
  if stat.S_ISLNK(s.st_mode):return
  if stat.S_ISDIR(s.st_mode):
   for child in sorted(path.iterdir()):scan(child,depth+1)
   return
  need(stat.S_ISREG(s.st_mode)and s.st_size<=1048576,'RESET_RETIRED_SCHEDULER_TYPE')
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  try:
   before=os.fstat(fd);raw=os.read(fd,1048577);after=os.fstat(fd);current=path.lstat()
   fields=lambda v:(v.st_dev,v.st_ino,v.st_size,v.st_mtime_ns,v.st_ctime_ns)
   need(fields(s)==fields(before)==fields(after)==fields(current)and len(raw)==s.st_size,'RESET_RETIRED_SCHEDULER_CHANGED')
  finally:os.close(fd)
  item={'path':str(path),'sha256':sha(raw)};scanned.append(item)
  if PATTERN.search(raw):matches.append(item)
 for source in SCHEDULERS:scan(Path(source))
 need(not matches,'RESET_RETIRED_UNKNOWN_SCHEDULED_PRODUCER')
 return sha(encoded(scanned))
def active_producers():
 count=0
 for path in Path('/proc').glob('[0-9]*/cmdline'):
  if path.parent.name==str(os.getpid()):continue
  try:
   with path.open('rb')as f:raw=f.read(1048577)
  except(FileNotFoundError,ProcessLookupError):continue
  need(len(raw)<=1048576,'RESET_RETIRED_PROCESS_INVENTORY_LIMIT')
  if PATTERN.search(raw):count+=1
 need(count==0,'RESET_RETIRED_PRODUCER_ACTIVE');return count
def current_inventory():
 bootstrap=json.loads(root_read(ROOT/'bootstrap-public.json',(0o444,)))
 need(bootstrap.get('dependencyImage')=='sha256:2e61857d00f7fe0326a7b50a8f96f0cb4563d4d9028645dc08efe51b84e800df'and bootstrap.get('copApiImage')=='sha256:28648cded21fbd52602a197693d0b0dc9eb213cd2bd84d6227b7da34c0cbab86','RESET_RETIRED_RUNTIME_BINDING')
 sim=bootstrap['sources']['sim'];need(sim['root']==str(ROOT/'sim')and sim['revision']in['15d8a75f1a260f1946e35774e727a2636decc841','08d81c335b362146c81e269c0c1e412b3e9d1ba9'],'RESET_RETIRED_SIM_BINDING')
 for relative in ['scripts/driver-report-inventory.mjs','deploy/account-safety/driver-report-files.mjs']:
  need(sha(root_read(ROOT/'sim'/relative,(0o444,0o555)))==sim['files'][relative],'RESET_RETIRED_INVENTORY_SOURCE_CHANGED')
 for relative,digest in [('usr/local/bin/node','c8726a01ce4ac245ea9e5cb483992a90e628e5847d98f9a9f3be048d09a50d75'),('lib/ld-musl-x86_64.so.1','38d022ce7425ff105ccfb53598f606e6e5f5f0a34bfbc793d65e6f34c9d72806')]:
  need(sha(root_read(ROOT/'runtime'/relative,(0o555,),200*1024*1024))==digest,'RESET_RETIRED_NODE_CHANGED')
 args=[str(ROOT/'runtime/lib/ld-musl-x86_64.so.1'),'--library-path',str(ROOT/'runtime/lib')+':'+str(ROOT/'runtime/usr/lib'),str(ROOT/'runtime/usr/local/bin/node'),'--input-type=module','-e',NODE]
 p=subprocess.run(args,stdin=subprocess.DEVNULL,capture_output=True,env=ENV,timeout=45)
 need(p.returncode==0 and len(p.stdout)<=1048576,'RESET_RETIRED_CURRENT_INVENTORY_FAILED');value=json.loads(p.stdout)
 need(isinstance(value,dict)and value.get('contractVersion')=='sim-driver-report-inventory-v1'and value.get('directory')==REPORT_DIRECTORY,'RESET_RETIRED_CURRENT_SCHEMA')
 need(value.get('producerMatches')==[] and type(value.get('activeProducerCount'))is int and value['activeProducerCount']==0,'RESET_RETIRED_PRODUCER_ACTIVE')
 need(all(type(value.get(k))is int and value[k]>=0 for k in ['fileCount','bytes'])and type(value.get('lockPresent'))is bool,'RESET_RETIRED_CURRENT_SCHEMA')
 return value
class Custody:
 def __init__(self):self.binding=None
 def inventory(self):
  need(os.getuid()==0 and socket.gethostname().split('.')[0]=='docker','RESET_RETIRED_ROOT_CONTEXT')
  lineage=retirement_digest();scheduled=scheduler_digest();active_producers()
  if self.binding is None:
   current=current_inventory()
   need(current['lockPresent']is False,'RESET_RETIRED_INITIAL_REPORT_LOCK')
  # Every fence rechecks actual schedulers, processes and Root receipts. File
  # mutations/locks later belong to the separately admitted reset worker.
  active_producers()
  need(scheduler_digest()==scheduled and retirement_digest()==lineage,'RESET_RETIRED_INVENTORY_DRIFT')
  value={'profile':'known-retired-v1','originalCronSha256':CRON_SHA,'paused':True,'activeProducerCount':0,'retirementReceiptSha256':lineage,'producerSourcesSha256':scheduled}
  binding=sha(encoded(value));need(self.binding in(None,binding),'RESET_RETIRED_CUSTODY_CHANGED');self.binding=binding
  return value
