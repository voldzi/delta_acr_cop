/** Synthetic owned app process; actual fixed native transport, no positive DI. */
import {nativeModule} from '/opt/cop-account-safety/root-native.mjs';
import {createProductionDriverRootPort} from '/opt/cop-account-safety/driver-root-channel.mjs';
import {createProductionDriverPublicationPort} from '/opt/cop-account-safety/driver-root-publication.mjs';
const port=createProductionDriverRootPort(); let release;
process.on('message',async message=>{
  if(message.action==='release'){release?.();return;}
  try {
    if(message.action==='hold-publication') {
      await createProductionDriverPublicationPort().withLease({kind:'aggregates'},async lease=>{
        await lease.assertCurrent();const settled=new Promise(resolve=>{release=resolve;});
        process.send({id:message.id,status:'held'});await settled;await lease.assertCurrent();
      });
      process.send({id:message.id,status:'done',result:'released'});return;
    }
    const result=message.action==='probe'?await port.probe(message.operation):await port.execute({operation:message.operation,body:message.body});
    process.send({id:message.id,status:'done',result});
  } catch(error) {process.send({id:message.id,status:'done',error:error.code??error.message});}
});
process.send({ready:true,pidfs:nativeModule().selfIdentity()});
