import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { nativeModule } from '/opt/cop-account-safety/root-native.mjs';
import { canonical,readPublicVerificationKeys } from '/opt/cop-account-safety/root-records.mjs';
import { createProductionDriverRootPort } from '/opt/cop-account-safety/driver-root-channel.mjs';
import { createProductionDriverRetentionConsumer,validateRetentionContext } from '/opt/cop-account-safety/driver-root-retention.mjs';
const native=nativeModule(),port=createProductionDriverRootPort();
process.on('message',async message=>{
  try {
    let result;
    if(message.action==='context'){
      const request={contractVersion:'cop-root-driver-retention-message-v1',requestId:randomUUID(),action:'current'};
      result=validateRetentionContext(await native.exchange(Buffer.from(canonical(request)+'\n')),request,readPublicVerificationKeys(),native.selfIdentity());
    }else{
      assert.equal(message.action,'run');
      await createProductionDriverRetentionConsumer().execute(async context=>{
        result=context;assert.equal((await port.execute({operation:context.operation,body:{contractVersion:'sim-driver-guarded-db-v1'}})).state,'origin-commit-known');
      });
    }
    process.send({id:message.id,status:'done',result});
  }catch(error){process.send({id:message.id,status:'done',error:error.code??error.message});}
});
process.send({ready:true,pidfs:native.selfIdentity()});
