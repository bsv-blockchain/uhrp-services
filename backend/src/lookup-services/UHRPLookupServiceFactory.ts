import { LookupService } from '@bsv/overlay'
import { Script, PushDrop, Utils, StorageUtils } from '@bsv/sdk'
import { UHRPRecord, UTXOReference } from '../types.js'
import { Db, Collection } from 'mongodb'
import uhrpLookupDocs from './UHRPLookupDocs.md.js'

/**
 * Implements a Lookup Service for the Universal Hash Resolution Protocol
 */
class UHRPLookupService implements LookupService {
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

  /**
   * Notifies the lookup service of a new output added.
   * @param {Object} obj all params are given in an object
   * @param {string} obj.txid the transactionId of the transaction this UTXO is apart of
   * @param {Number} obj.outputIndex index of the output
   * @param {Buffer} obj.outputScript the outputScript data for the given UTXO
   * @returns {string} indicating the success status
   */
  async outputAdded(txid: string, outputIndex: number, outputScript: Script, topic: string) {
    if (topic !== 'tm_uhrp') return
    // Decode the UHRP fields from the Bitcoin outputScript
    const result = PushDrop.decode(outputScript)

    // UHRP advertisement Fields to store (from the UHRP protocol's PushDrop field order)
    const hostIdentityKey = Utils.toHex(result.fields[0])
    const uhrpUrl = StorageUtils.getURLForHash(result.fields[1])
    const hostedFileLocation = Utils.toUTF8(result.fields[2])
    const expiryTime = new Utils.Reader(result.fields[3]).readVarIntNum()
    const fileSize = new Utils.Reader(result.fields[4]).readVarIntNum()

    // Store UHRP fields in db
    await this.records.insertOne({
      uhrpUrl,
      txid,
      outputIndex,
      hostIdentityKey,
      hostedFileLocation,
      expiryTime,
      fileSize
    })
  }

  /**
   * Deletes the output record once the UTXO has been spent
   * @param {ob} obj all params given inside an object
   * @param {string} obj.txid the transactionId the transaction the UTXO is apart of
   * @param {Number} obj.outputIndex the index of the given UTXO
   * @param {string} obj.topic the topic this UTXO is apart of
   * @returns
   */
  async outputSpent(txid: string, outputIndex: number, topic: string) {
    if (topic !== 'tm_uhrp') return
    await this.records.deleteOne({ txid, outputIndex })
  }

  /**
   *
   * @param {object} obj all params given in an object
   * @param {object} obj.query lookup query given as an object
   * @returns {object} with the data given in an object
   */
  async lookup({ query }: any): Promise<UTXOReference[]> {
    // Validate Query
    if (typeof query !== 'object') {
      throw new Error('Lookup must include a valid query!')
    }
    if (query.outpoint) {
      const [txid, outputIndex] = (query.outpoint as string).split('.')
      const result = await this.records.findOne({ txid, outputIndex: Number(outputIndex) })
      if (!result) return []
      return [{ txid: result.txid, outputIndex: result.outputIndex }]
    }
    if (!query.uhrpUrl && !query.expiryTime && !query.hostIdentityKey) {
      throw new Error('Lookup must specify either outpoint, or at least one of (uhrpUrl, expiryTime, hostIdentityKey)')
    }
    const result = await this.records.find(query).toArray()
    return result.map(x => ({
      txid: x.txid,
      outputIndex: x.outputIndex
    }))
  }
}

export default (db: Db) => new UHRPLookupService(db);
