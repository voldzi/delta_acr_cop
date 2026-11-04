"""Pure reversible extension of the exact accepted guard; no host writes."""
import hashlib
BASE='593874714db6b35537ffe733a8f266483685f37a0d5e6c73abb4159f9503f9d2'
PARENT='6609d8c272c8ec534a96de3233e85a50bddb062bb388bf8417de05f6d7b384b9'
VERSION='cop-application-owned-image-v1'
def construct(raw,kernel):
 if hashlib.sha256(raw).hexdigest()!=BASE:raise ValueError('APP_EXACT_GUARD_REQUIRED')
 compile(kernel,'<application-kernel>','exec');text=raw.decode()
 old="PLANNING_CONFIG_V3_KERNEL_SHA256 = '"+PARENT+"'"
 new="PLANNING_CONFIG_V3_KERNEL_SHA256 = '"+hashlib.sha256(kernel).hexdigest()+"'\nAPPLICATION_IMAGE_VERSION = '"+VERSION+"'"
 if text.count(old)!=1:raise ValueError('APP_KERNEL_ANCHOR')
 original='PLANNING_CONFIG_V3_VERSION, PLANNING_ENABLE_V4_VERSION, ADMISSION_IMAGE_VERSION}'
 count=text.count(original)
 if count!=8:raise ValueError('APP_DISPATCH_ANCHORS')
 changed=original[:-1]+', APPLICATION_IMAGE_VERSION}'
 text=text.replace(old,new).replace(original,changed)
 if text.replace(new,old).replace(changed,original).encode()!=raw:raise ValueError('APP_PARENT_NOT_PRESERVED')
 compile(text,'<application-guard>','exec');return text.encode()
