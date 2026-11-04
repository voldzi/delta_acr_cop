#!/usr/bin/python3
"""Candidate-only reuse of immutable existing read-only profile/guard probes.
Never activates an image or copies production credentials to this workstation.
The X5 fixture tests the image's OWN compiled module, not a local replacement.
"""
import argparse,ast,hashlib,os,re,socket
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
PINS={'database':'dd93c292f8a873d07980605b3fb2bfe5088ddc1ba686684fce73767b72ea7a5b','guard':'868740092086b4f63763f1fda13922c09f4c5c70c5346f52bdaf87bac0d315ce'}
def replace_once(text,old,new):
 if text.count(old)!=1:raise ValueError('COMPATIBILITY_EXACT_ANCHOR')
 return text.replace(old,new)
def candidate_probe(mode,image,local=False):
 if not re.fullmatch('sha256:[a-f0-9]{64}',image):raise ValueError('CANDIDATE_IMAGE_REQUIRED')
 name='run-image-profile-'+('database' if mode=='database' else 'guard')+'-probe.py'
 path=ROOT/'scripts/account-safety'/name;raw=path.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=PINS[mode]:raise ValueError('IMMUTABLE_PROBE_CHANGED')
 text=raw.decode()
 # Keep source imports and helpers anchored to the repository, regardless of CLI cwd.
 text=replace_once(text,'ROOT=pathlib.Path(__file__).resolve().parents[2]','ROOT=pathlib.Path('+repr(str(ROOT))+')')
 text=text.replace("'-o','HostName=192.168.10.116','-o','HostKeyAlias=docker.home.cz',",'')
 if mode=='database':
  text=replace_once(text,"args+=['--entrypoint','node',active['imageId']","args+=['--entrypoint','node',"+repr(image))
  text=replace_once(text,"'nodeBaseImageId':active['imageId']","'nodeBaseImageId':"+repr(image)+",'acceptedSourceImageId':active['imageId']")
 else:
  old="NODE='sha256:a06c103764701e7debc6434e3dd98e9a6d5f218d30831cb62aad566265db392f'"
  text=replace_once(text,old,'NODE='+repr(image))
  text=text.replace(",'--tmpfs','/app/apps/cop-api/dist:rw,noexec,nosuid,size=8m'",'')
  text=replace_once(text,",'/app/apps/cop-api/dist/media-conversion.js':ROOT/'apps/cop-api/dist/media-conversion.js'",'')
  text=replace_once(text,",'/app/apps/cop-api/dist/media-conversion.js'",'')
  text=replace_once(text,"'compiledConversionSha256':hashlib.sha256(files['/app/apps/cop-api/dist/media-conversion.js'].read_bytes()).hexdigest()","'compiledConversionSha256':docker('exec',created[0],'node','-e',\"const fs=require('fs'),c=require('crypto');console.log(c.createHash('sha256').update(fs.readFileSync('/app/apps/cop-api/dist/media-conversion.js')).digest('hex'))\")")
 if local:
  if os.geteuid()!=0 or socket.gethostname().split('.')[0]!='docker':raise ValueError('LOCAL_ROOT_DOCKER_REQUIRED')
  if mode=='database':
   text=replace_once(text,"r=subprocess.run(SSH+[shlex.join(['python3','-B','-c',source])],input=","r=subprocess.run(['/usr/bin/python3','-I','-c',source],input=")
  else:
   text=replace_once(text,"r=subprocess.run(SSH+[shlex.join(args)],input=body,","r=subprocess.run(list(args),input=body,")
 # The reused SQL path remains BEGIN READ ONLY, and its finally blocks retain
 # exact owner-checked fixture cleanup; no account mutation or DDL is added.
 ast.parse(text);return path,text
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('mode',choices=['database','guard']);parser.add_argument('--image',required=True);parser.add_argument('--local-host',action='store_true');args=parser.parse_args()
 path,text=candidate_probe(args.mode,args.image,args.local_host)
 exec(compile(text,str(path),'exec'),{'__name__':'__main__','__file__':str(path)})
