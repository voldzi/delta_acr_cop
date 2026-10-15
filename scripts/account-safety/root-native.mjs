import { createRequire } from 'node:module';
import { requireRootCodeTree } from './root-records.mjs';

export function nativeModule() {
  requireRootCodeTree('/opt/cop-account-safety');
  const require = createRequire('/opt/cop-account-safety/package.json');
  return require('/opt/cop-account-safety/native/root-seqpacket.node');
}
