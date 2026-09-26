import test from 'node:test'
import assert from 'node:assert/strict'
import factory from '../dist/esm/src/lookup-services/UHRPLookupServiceFactory.js'
import { StorageUtils } from '@bsv/sdk'
const url = StorageUtils.getURLForHash(Array(32).fill(5))
const first = { txid: '11'.repeat(32), outputIndex: 0, uhrpUrl: url, expiryTime: 2_000_000_000 }
const second = { ...first, txid: '22'.repeat(32) }
function fixture(rows = [first, second]) {
  let filter, skip = 0, limit = 200
  const cursor = { sort() { return this }, skip(n) { skip = n; return this }, limit(n) { limit = n; return this }, async toArray() {
    const filters = filter.$and
    return rows.filter(row => filters.every(f => Object.entries(f).every(([k,v]) => typeof v === 'object' ? row[k] > v.$gt : row[k] === v))).slice(skip, skip + limit)
  } }
  const records = { find(f) { filter = f; return cursor } }
  return { service: factory({ collection: () => records }), filter: () => filter }
}
test('modern SDK pagination returns the same fixture as a legacy query', async () => {
  const { service, filter } = fixture()
  const legacy = await service.lookup({ query: { uhrpUrl: url } })
  assert.equal(legacy.length, 2)
  assert.deepEqual(await service.lookup({ query: { uhrpUrl: url, limit: 200, offset: 0 } }), legacy)
  assert.deepEqual(filter().$and[0], { uhrpUrl: url })
  assert.deepEqual(await service.lookup({ query: { uhrpUrl: url, limit: 1, offset: 1 } }), [{ txid: second.txid, outputIndex: 0 }])
})
test('keeps expiry filtering and outpoint selection', async () => {
  const { service } = fixture([{ ...first, expiryTime: 1 }, second])
  assert.deepEqual(await service.lookup({ query: { uhrpUrl: url } }), [{ txid: second.txid, outputIndex: 0 }])
  assert.deepEqual(await service.lookup({ query: { outpoint: second.txid + '.0' } }), [{ txid: second.txid, outputIndex: 0 }])
})
test('rejects unbounded pagination and database operator injection', async () => {
  const { service } = fixture()
  for (const query of [null, [], {}, { uhrpUrl: url, limit: 201 }, { uhrpUrl: url, offset: -1 }, { uhrpUrl: url, offset: 1_000_001 }, { uhrpUrl: url, limit: '1' }, { uhrpUrl: { $ne: null } }, { uhrpUrl: url, $where: 'anything' }, { expiryTime: { $gt: 0 } }, { outpoint: 'invalid' }]) {
    await assert.rejects(service.lookup({ query }))
  }
})
