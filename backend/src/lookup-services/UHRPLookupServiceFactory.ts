import { AdmissionMode, LookupService, OutputAdmittedByTopic, OutputSpent, SpendNotificationMode } from '@bsv/overlay'
import { PushDrop, Utils, StorageUtils } from '@bsv/sdk'
import { UHRPRecord, UTXOReference } from '../types.js'
import { Db, Collection } from 'mongodb'
import uhrpLookupDocs from './UHRPLookupDocs.md.js'

/**
 * Implements a Lookup Service for the Universal Hash Resolution Protocol
 */
class UHRPLookupService implements LookupService {
  readonly admissionMode: AdmissionMode = 'locking-script'
  readonly spendNotificationMode: SpendNotificationMode = 'none'
  records: Collection<UHRPRecord>

  constructor(db: Db) {
    this.records = db.collection<UHRPRecord>('uhrp')
  }

  async getDocumentation(): Promise<string> {
    return uhrpLookupDocs
  }

  async getMetaData(): Promise<{ name: string; shortDescription: string; iconURL?: string; version?: string; informationURL?: string }> {
    return {
      name: 'UHRP Lookup Service',
      shortDescription: 'Lookup Service for User file hosting commitment tokens'
    }
  }

  async outputAdmittedByTopic(payload: OutputAdmittedByTopic) {
    if (payload.mode !== 'locking-script') throw new Error('Invalid payload')
    const { topic, txid, outputIndex, lockingScript } = payload
    if (topic !== 'tm_uhrp') return
    // Decode the UHRP fields from the Bitcoin outputScript
    const result = PushDrop.decode(lockingScript)

    // UHRP advertisement Fields to store (from the UHRP protocol's PushDrop field order)
    const hostIdentityKey = Utils.toHex(result.fields[0])
    const uhrpUrl = StorageUtils.getURLForHash(result.fields[1])
    const hostedFileLocation = Utils.toUTF8(result.fields[2])
    const expiryTime = new Utils.Reader(result.fields[3]).readVarIntNum()
    const fileSize = new Utils.Reader(result.fields[4]).readVarIntNum()

    // Store UHRP fields idempotently. Overlay submissions can be retried by
    // multiple SHIP peers, so a repeated admission must not create duplicate
    // public locations.
    await this.records.updateOne(
      { txid, outputIndex },
      {
        $set: {
          uhrpUrl,
          hostIdentityKey,
          hostedFileLocation,
          expiryTime,
          fileSize
        }
      },
      { upsert: true }
    )
  }

  async outputSpent(payload: OutputSpent) {
    if (payload.mode !== 'none') throw new Error('Invalid payload')
    const { topic, txid, outputIndex } = payload
    if (topic !== 'tm_uhrp') return
    await this.records.deleteOne({ txid, outputIndex })
  }

  async outputEvicted(txid: string, outputIndex: number) {
    await this.records.deleteOne({ txid, outputIndex })
  }

  async lookup({ query }: { query: unknown }): Promise<UTXOReference[]> {
    const { filter, limit, offset } = normalizeLookupQuery(query)
    const result = await this.records.find({
      $and: [filter, { expiryTime: { $gt: Math.floor(Date.now() / 1000) } }]
    }).sort({ txid: 1, outputIndex: 1 }).skip(offset).limit(limit).toArray()
    return result.map(x => ({ txid: x.txid, outputIndex: x.outputIndex }))
  }

}

export default (db: Db) => new UHRPLookupService(db);

/** Pagination controls are not persisted advertisement fields. */
function normalizeLookupQuery(value: unknown): { filter: Record<string, unknown>; limit: number; offset: number } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Lookup requires an object query')
  const query = value as Record<string, unknown>
  const allowed = new Set(['outpoint', 'uhrpUrl', 'expiryTime', 'hostIdentityKey', 'limit', 'offset'])
  if (Object.keys(query).some(key => !allowed.has(key))) throw new Error('Unsupported lookup query field')
  const limit = query.limit ?? 200
  const offset = query.offset ?? 0
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
      typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
    throw new Error('Invalid lookup pagination')
  }
  const filter = lookupSelectors(query)
  return { filter, limit, offset }
}

function lookupSelectors(query: Record<string, unknown>): Record<string, unknown> {
  if (query.outpoint !== undefined) {
    if (typeof query.outpoint !== 'string') throw new Error('Invalid lookup outpoint')
    const match = /^([0-9a-f]{64})\.(0|[1-9]\d*)$/.exec(query.outpoint)
    if (match === null || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) > 0xffffffff) throw new Error('Invalid lookup outpoint')
    return { txid: match[1], outputIndex: Number(match[2]) }
  }
  const filter: Record<string, unknown> = {}
  if (query.uhrpUrl !== undefined) {
    if (typeof query.uhrpUrl !== 'string' || query.uhrpUrl.length > 256) throw new Error('Invalid UHRP URL')
    filter.uhrpUrl = StorageUtils.getURLForHash(StorageUtils.getHashFromURL(query.uhrpUrl))
  }
  if (query.expiryTime !== undefined) {
    if (typeof query.expiryTime !== 'number' || !Number.isSafeInteger(query.expiryTime) || query.expiryTime < 1) throw new Error('Invalid lookup expiry')
    filter.expiryTime = query.expiryTime
  }
  if (query.hostIdentityKey !== undefined) {
    if (typeof query.hostIdentityKey !== 'string' || !/^(?:02|03)[0-9a-f]{64}$/.test(query.hostIdentityKey)) throw new Error('Invalid host identity')
    filter.hostIdentityKey = query.hostIdentityKey
  }
  if (Object.keys(filter).length === 0) throw new Error('Lookup requires a selector')
  return filter
}
