"""Offline byte-exact proposal only. No installer or production execution."""
import copy,hashlib,json,re
BASE='e3d31a74d1c9cf296ad2afb26382824dbbd1c5faec2fcc59d954950216c14fc3'
BROKER='3bf7b52b37a2d685033e4af9ae26d4681cd1ab45fb216238a87e806dc29e9309'
PARENT='c74e60fc58ef31fe2e8bca422345460c32575bca34db7255bdca2c9ddf38d9a1'
VERSION='cop-shared-vehicle-admission-window-v1'
def sha(v):return hashlib.sha256(v).hexdigest()
def construct(raw,kernel):
 if sha(raw)!=BASE:raise ValueError('WINDOW_EXACT_GUARD_REQUIRED')
 compile(kernel,'<window-kernel>','exec');text=raw.decode();anchor="PLANNING_CONFIG_V3_KERNEL_SHA256 = '"+PARENT+"'"
 replacement="PLANNING_CONFIG_V3_KERNEL_SHA256 = '"+sha(kernel)+"'\nVEHICLE_WINDOW_VERSION = '"+VERSION+"'"
 suffix='PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION, ADMISSION_IMAGE_VERSION, APPLICATION_IMAGE_VERSION}'
 expanded=suffix[:-1]+', VEHICLE_WINDOW_VERSION}'
 if text.count(anchor)!=1 or text.count(suffix)!=8:raise ValueError('WINDOW_DISPATCH_ANCHORS')
 changed=text.replace(anchor,replacement).replace(suffix,expanded)
 if changed.replace(replacement,anchor).replace(expanded,suffix).encode()!=raw:raise ValueError('WINDOW_HISTORICAL_BYTES_CHANGED')
 compile(changed,'<window-guard>','exec');return changed.encode()
POLICY='2517bfc17a2d11e6a87ac2fc3a280b51da79c5044228f716cdb71ad9d13f84a7'
def repin_policy(raw,new_guard):
 if sha(raw)!=POLICY:raise ValueError('WINDOW_EXACT_POLICY_REQUIRED')
 value=json.loads(raw)
 if value.get('contractVersion')!='cop-self-release-policy-v1' or value.get('guardSha256')!=BASE or value.get('assets',{}).get('scripts/cop-api-runtime.py')!=BASE or value['assets'].get('scripts/self-deploy/broker.py')!=BROKER:raise ValueError('WINDOW_POLICY_SCOPE')
 target=copy.deepcopy(value);target['guardSha256']=sha(new_guard);target['assets']['scripts/cop-api-runtime.py']=sha(new_guard)
 verify=copy.deepcopy(target);verify['guardSha256']=value['guardSha256'];verify['assets']['scripts/cop-api-runtime.py']=value['assets']['scripts/cop-api-runtime.py']
 if verify!=value:raise ValueError('WINDOW_POLICY_CAPABILITY_CHANGED')
 return json.dumps(target,sort_keys=True,separators=(',',':')).encode()+b'\n'
