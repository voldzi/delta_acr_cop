import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
assert.equal(process.env.COP_OWNED_NATIVE_FIXTURE, '1');
const require = createRequire(import.meta.url), native = require('/tmp/cop-root-seqpacket.node');
process.on('message', async message => {
  try {
    const response = await native.exchange(Buffer.from(message.hex, 'hex'));
    process.send({ ok: true, hex: response.toString('hex') });
  } catch (error) { process.send({ ok: false, error: error.message }); }
});
process.send({ ready: true });
