/** Run inside COP API; prints only bounded policy transport outcomes. No content or keys. */
export async function checkPolicyTransport(env, fetcher=fetch) {
  if (!env.COP_CSM_MESSAGING_BASE_URL || !env.COP_CSM_MESSAGING_TOKEN) return {ok:false,code:'POLICY_CONFIG_MISSING'};
  const actor='cop-policy-readonly-invalid-self-probe';
  const url=env.COP_CSM_MESSAGING_BASE_URL.replace(/\/$/u,'')+'/api/v1/communication/direct-allowed';
  async function probe(token) {
    const response=await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{authorization:'Bearer '+token,'x-csm-user-id':actor,'content-type':'application/json'},body:JSON.stringify({peerId:actor})});
    const reader=response.body?.getReader();let size=0;const parts=[];
    try {
      if (reader) for (;;) {const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>32768)throw Error('oversize');parts.push(item.value);}
      const body=JSON.parse(Buffer.concat(parts).toString('utf8'));
      return {status:response.status,code:body?.error?.code};
    } finally {await reader?.cancel();}
  }
  try {
    const unauthenticated=await probe('invalid-readonly-policy-probe');
    if(unauthenticated.status!==401 || unauthenticated.code!=='UNAUTHORIZED')return {ok:false,code:'POLICY_AUTH_BOUNDARY_UNPROVEN'};
    const authenticated=await probe(env.COP_CSM_MESSAGING_TOKEN);
    if(authenticated.status===503)return {ok:false,code:'POLICY_DEPENDENCY_UNAVAILABLE'};
    if(authenticated.status===401)return {ok:false,code:'POLICY_SERVICE_TOKEN_REJECTED'};
    if(authenticated.status!==400 || authenticated.code!=='VALIDATION_ERROR')return {ok:false,code:'POLICY_VALIDATION_BOUNDARY_UNPROVEN'};
    return {ok:true,unauthorizedHttp:401,invalidSelfPairHttp:400,accountOrCallCreated:false};
  } catch {return {ok:false,code:'POLICY_TRANSPORT_UNPROVEN'};}
}
if (import.meta.url===`file://${process.argv[1]}` || process.argv[1]==='-') {
 const result=await checkPolicyTransport(process.env);console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
