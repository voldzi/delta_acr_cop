import subprocess,time,json,pathlib,sys
image=sys.argv[1];proof=pathlib.Path(sys.argv[2]);name='cop-identity-normal-start-full-20261006'
def run(a):return subprocess.run(a,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
def rpc(expr):
 r=run(['docker','exec',name,'/app/bin/csm_messaging','rpc',expr]);assert r.returncode==0,'isolated RPC failed';return json.loads(r.stdout.strip().splitlines()[-1])
envs={'ERL_FLAGS':'+S 2:2 +SDcpu 1 +SDio 1','DATABASE_URL':'ecto://synthetic:synthetic@127.0.0.1:1/synthetic','SECRET_KEY_BASE':'synthetic-isolated-secret-with-no-production-access-0000000000000000','CSM_MESSAGING_START_REPO':'false','CSM_MESSAGING_STORE_BACKEND':'local-json','CSM_MESSAGING_API_TOKEN':'synthetic-normal-start-token','CSM_MESSAGING_REQUIRE_AUTH':'true','CSM_MATRIX_SERVER_NAME':'matrix.example.test','PHX_SERVER':'true','PORT':'4000','PHX_HOST':'localhost'}
a=['docker','run','-d','--name',name,'--network','none','--tmpfs','/data','--tmpfs','/tmp'];
for k,v in envs.items():a+=['-e',k+'='+v]
a+=['--entrypoint','/app/bin/csm_messaging',image,'start'];assert run(a).returncode==0
try:
 startup=None
 for i in range(40):
  try:
   startup=rpc('IO.puts(Jason.encode!(%{mode: Atom.to_string(:code.get_mode()), moduleLoaded: :code.is_loaded(CsmMessaging.MatrixIdentityLookup) != false, functionExported: :erlang.function_exported(CsmMessaging.MatrixIdentityLookup, :lookup_response, 2), applicationStarted: Enum.any?(Application.started_applications(), fn {a,_,_} -> a == :csm_messaging end)}))')
   if startup=={'mode':'embedded','moduleLoaded':True,'functionExported':True,'applicationStarted':True}:break
  except (AssertionError,ValueError):pass
  time.sleep(1)
 else:raise AssertionError('normal embedded startup unavailable')
 print(json.dumps({'normalStartup':startup}),flush=True)
 seeded=rpc('''server="matrix.example.test"; :sys.replace_state(CsmMessaging.Conversations, fn s -> Map.put(s,"conversations",%{"room-1" => %{"conversationId"=>"room-1","members"=>[%{"userId"=>"actor-a"},%{"userId"=>"actor-b"}],"matrix"=>%{"roomId"=>"!room:matrix.example.test"}}}) end); entries=for id <- ["actor-a","actor-b"], into: %{} do; key=:crypto.hash(:sha256,server<>"\\0"<>id)|>Base.encode16(case: :lower)|>String.slice(0,24); {key,%{"csmUserId"=>id,"matrixUserId"=>"@cop_"<>id<>"_opaquehash:"<>server,"serverName"=>server,"displayName"=>"Synthetic unchanged","password"=>"synthetic-only-password","deactivated"=>true}}; end; :sys.replace_state(CsmMessaging.MatrixIdentityStore, &Map.put(&1,"identities",entries)); IO.puts(Jason.encode!(%{fixtureSeeded: true}))''')
 assert seeded['fixtureSeeded']
 def state():return rpc('IO.puts(Jason.encode!(%{hash: Base.encode16(:crypto.hash(:sha256,:erlang.term_to_binary(Enum.map([CsmMessaging.Conversations,CsmMessaging.MatrixIdentityStore], &:sys.get_state/1))))}))')['hash']
 before=state();cases=[]
 def http(label,actor,body,expected,token=True):
  a=['docker','exec',name,'wget','-S','-O','-','--header','Content-Type: application/json']
  if token:a+=['--header','Authorization: Bearer synthetic-normal-start-token']
  if actor:a+=['--header','x-csm-user-id: '+actor]
  r=run(a+['--post-data',json.dumps(body),'http://127.0.0.1:4000/api/v1/matrix/identities/lookup']);import re
  status=re.findall(r'HTTP/1\.[01] (\d+)',r.stderr);assert status and int(status[-1])==expected,(label,status)
  if expected==200:
   b=json.loads(r.stdout);assert b['contractVersion']=='csm-messaging-identity-lookup-v1' and b['actorUserId']==actor and b['conversationId']=='room-1' and b['matrixRoomId']=='!room:matrix.example.test' and b['unresolvedUserIds']==[]
   assert sorted(x['userId'] for x in b['identities'])==['actor-a','actor-b'];assert all(sorted(x)==['matrixUserId','userId'] for x in b['identities']);assert 'password' not in r.stdout
  item={'case':label,'status':expected};cases.append(item);print(json.dumps(item),flush=True)
 http('actorA','actor-a',{'conversationId':'room-1'},200);http('actorB','actor-b',{'conversationId':'room-1'},200);http('nonmember','outside',{'conversationId':'room-1'},403);http('unauthorized',None,{'conversationId':'room-1'},401,False);http('missingActor',None,{'conversationId':'room-1'},401);http('forbiddenFields','actor-a',{'conversationId':'room-1','userIds':['forbidden']},400);http('scopedMissing','actor-a',{'conversationId':'synthetic-missing'},404)
 assert state()==before,'read-only store mutated';logs=run(['docker','logs',name]);assert 'UndefinedFunctionError' not in logs.stdout+logs.stderr
 result={'normalStartPassed':True,'startup':startup,'twoActorsPassed':True,'storesUnchanged':True,'noCodeEvalFileOrEnsureLoaded':True,'syntheticOnly':True,'network':'none','noProductionMounts':True,'cases':cases};proof.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'fullNormalStartAcceptance':'passed'}),flush=True)
finally:
 run(['docker','rm','-f','-v',name])
