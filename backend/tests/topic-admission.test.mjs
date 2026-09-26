import test from 'node:test'
import assert from 'node:assert/strict'
import { PrivateKey, ProtoWallet, PushDrop, Transaction, Script, Utils } from '@bsv/sdk'
import UHRPTopicManager from '../dist/esm/src/topic-managers/UHRPTopicManager.js'
async function advertisement(expiry = 2_000_000_000) {
  const wallet = new ProtoWallet(PrivateKey.fromRandom())
  const script = await new PushDrop(wallet).lock([
    Utils.toArray((await wallet.getPublicKey({ identityKey: true })).publicKey,'hex'),
    Array(32).fill(5), Utils.toArray('https://files.example/cdn/3mJr7AoUXx2Wqd','utf8'),
    new Utils.Writer().writeVarIntNum(expiry).toArray(), new Utils.Writer().writeVarIntNum(133).toArray()
  ], [2,'uhrp advertisement'],'1','anyone',true)
  const tx = new Transaction()
  tx.addInput({sourceTXID:'33'.repeat(32),sourceOutputIndex:0,unlockingScript:Script.fromASM('OP_0')})
  tx.addOutput({satoshis:1,lockingScript:script})
  return tx.toBEEF(true)
}
test('admits a current SDK host-signed advertisement', async () => {
  assert.deepEqual(await new UHRPTopicManager().identifyAdmissibleOutputs(await advertisement(),[]), {outputsToAdmit:[0],coinsToRetain:[]})
})
test('keeps expired advertisements out of the public topic', async () => {
  assert.deepEqual(await new UHRPTopicManager().identifyAdmissibleOutputs(await advertisement(1),[]), {outputsToAdmit:[],coinsToRetain:[]})
})
