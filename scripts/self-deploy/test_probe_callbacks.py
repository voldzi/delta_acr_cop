import importlib.util,os,shutil,subprocess,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('probe',Path(__file__).with_name('probe-continuity-stable.py'));p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class PgDiagnosticCallbacks(unittest.TestCase):
 @unittest.skipUnless(os.environ.get('NODE_BIN') or shutil.which('node'),'Node required for callback/promise interoperability')
 def test_pg_callback_and_promise_contract_unchanged(self):
  start=p.SCRIPT.index('function note(');end=p.SCRIPT.index('try {owner=',start);body=p.SCRIPT[start:end]
  source="""const failures=[];let callbackCalls=0;const pg={Client:class {query(...args){const cb=args.at(-1);const error=args[0]==='SELECT fail'?Object.assign(new Error('synthetic'),{code:'42501'}):null;if(typeof cb==='function'){callbackCalls++;cb(error,{rows:[{n:1}]});return 'original-return'}return error?Promise.reject(error):Promise.resolve({rows:[{n:1}]})}}};const originalQuery=pg.Client.prototype.query;"""+body+"""const client=new pg.Client();const ret=client.query('SELECT ok',(error,result)=>{if(error||result.rows[0].n!==1)throw new Error('callback altered')});if(ret!=='original-return'||callbackCalls!==1)throw new Error('callback return altered');const result=await client.query('SELECT ok');if(result.rows[0].n!==1)throw new Error('promise altered');try{await client.query('SELECT fail');throw new Error('error hidden')}catch(e){if(e.code!=='42501')throw e}client.query('SELECT fail',(e)=>{if(e.code!=='42501')throw new Error('callback error hidden')});if(failures.length!==2||!failures.every(v=>v.sqlState==='42501'))throw new Error('safe diagnostics missing');"""
  result=subprocess.run([os.environ.get('NODE_BIN') or 'node','--input-type=module','-e',source],capture_output=True,text=True,timeout=10)
  self.assertEqual(result.returncode,0,result.stderr)
if __name__=='__main__':unittest.main()
