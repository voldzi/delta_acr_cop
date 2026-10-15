import {nativeModule} from '/opt/cop-account-safety/root-native.mjs';
process.send({ready:true,pidfs:nativeModule().selfIdentity()});
process.on('message',()=>{});
