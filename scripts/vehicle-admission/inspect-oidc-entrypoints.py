"""Public read-only native login/registration shape; never submits a form.
No cookie, challenge, session-state, form action, field value or page is printed.
"""
import base64,hashlib,http.cookiejar,json,secrets,urllib.parse,urllib.request
from html.parser import HTMLParser
ISSUER='https://login.zeleznalady.cz/realms/cop'
class Parser(HTMLParser):
 def __init__(self):super().__init__();self.registration=None;self.fields=[];self.forms=[]
 def handle_starttag(self,tag,items):
  a=dict(items)
  if tag=='a' and 'login-actions/registration' in a.get('href',''):self.registration=a['href']
  if tag=='input' and a.get('name'):self.fields.append({'name':a['name'],'required':'required' in a,'type':a.get('type','text')})
  if tag=='form':self.forms.append(a.get('id'))
class Redirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  u=urllib.parse.urlsplit(newurl)
  if u.scheme!='https' or u.hostname!='login.zeleznalady.cz':raise ValueError('OIDC_UNEXPECTED_REDIRECT')
  return super().redirect_request(req,fp,code,msg,headers,newurl)
def inspect():
 jar=http.cookiejar.CookieJar();op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),Redirect())
 with op.open(ISSUER+'/.well-known/openid-configuration',timeout=15) as response:discovery=json.load(response)
 assert discovery.get('issuer')==ISSUER and 'S256' in discovery.get('code_challenge_methods_supported',[])
 for key in ('authorization_endpoint','token_endpoint'):
  u=urllib.parse.urlsplit(discovery[key]);assert u.scheme=='https' and u.netloc=='login.zeleznalady.cz'
 verifier=secrets.token_urlsafe(48);challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
 q={'client_id':'csm-mobile','redirect_uri':'csm://oauth/callback','response_type':'code','scope':'openid profile offline_access','state':secrets.token_urlsafe(24),'nonce':secrets.token_urlsafe(24),'code_challenge':challenge,'code_challenge_method':'S256'}
 with op.open(discovery['authorization_endpoint']+'?'+urllib.parse.urlencode(q),timeout=15) as response:login=Parser();login.feed(response.read(524288).decode(errors='replace'))
 registration=None
 if login.registration:
  url=urllib.parse.urljoin(ISSUER+'/',login.registration);u=urllib.parse.urlsplit(url);assert u.scheme=='https' and u.netloc=='login.zeleznalady.cz' and u.path.startswith('/realms/cop/login-actions/registration')
  with op.open(url,timeout=15) as response:
   page=Parser();page.feed(response.read(524288).decode(errors='replace'));registration={'http':response.status,'formIds':page.forms,'fields':page.fields}
 return {'contractVersion':'cop-native-oidc-readonly-provisioning-v1','issuer':ISSUER,'clientId':'csm-mobile','redirectUri':'csm://oauth/callback','pkce':'S256','loginFormAdvertised':any(x['name']=='username' for x in login.fields),'registrationAdvertised':bool(login.registration),'registrationForm':registration,'realmVerificationConfigurationRead':False,'credentialsRead':False,'identityCreated':False,'formSubmitted':False,'privateStatePrinted':False}
if __name__=='__main__':
 try:print(json.dumps(inspect()))
 except Exception:print(json.dumps({'completed':False,'code':'OIDC_READONLY_SHAPE_UNPROVEN','identityCreated':False}));raise SystemExit(2)
