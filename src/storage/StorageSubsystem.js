/* TODO: we probably want to be able to distinguish between
 * incremental & compacted writes due to cost & frequency -> give the option for two storage engines
 * we probably also want to have compaction callbacks. count / timeout / manual calls...
 */

import * as Automerge from '../../vendor/automerge-js/index.js'

export default class StorageSubsystem {
  storageAdapter

  constructor(storageAdapter) {
    this.storageAdapter = storageAdapter
  }

  queuedChanges = {}

  saveIncremental(documentId, change) {
    if (!this.queuedChanges[documentId]) {
      this.queuedChanges[documentId] = []
    }
    const changes = this.queuedChanges[documentId]
    changes.push(change)
    const index = changes.length - 1
    this.storageAdapter.save(`${documentId}:incremental:${index}`, change)
  }

  saveTotal(documentId, doc) {
    // TODO: can we do incremental save that takes advantage of the last binary?
    const binary = Automerge.save(doc)
    this.storageAdapter.save(`${documentId}:snapshot`, binary)

    const changes = this.queuedChanges[documentId] || []
    changes.forEach((c, index) => {
      this.storageAdapter.remove(`${documentId}:incremental:${index}`)
    })
    this.queuedChanges[documentId] = []
  }

  async loadWithIncremental(documentId) {
    const binary = await this.storageAdapter.load(`${documentId}:snapshot`)
    // TODO: this is bad because we really only want to do this if we *have* incremental changes
    if (!binary) { console.log('no binary, gonna just do an init()') }

    let doc = (binary) ? Automerge.load(binary) : Automerge.init()

    const changes = this.queuedChanges[documentId] || []

    let index = 0
    let change
    // eslint-disable-next-line no-await-in-loop, no-cond-assign
    while (change = await this.storageAdapter.load(`${documentId}:incremental:${index}`)) {
      changes.push(change);
      // applyChanges has a second return we don't need, so we destructure here
      [doc] = Automerge.applyChanges(doc, [change])
      index += 1
    }

    this.queuedChanges[documentId] = changes
    return doc
  }

  // TODO: make this, you know, good.
  shouldCompact(documentId) {
    const numQueued = (this.queuedChanges[documentId] || []).length
    return numQueued >= 3
  }

  onDocument(handle) {
    handle.on('change', ({ documentId, doc, latestChange }) => {
      if (this.shouldCompact(documentId)) {
        this.saveTotal(documentId, doc)
      } else {
        this.saveIncremental(documentId, latestChange)
      }
    })
  }

  async load(docId) {
    return this.loadWithIncremental(docId)
  }
}
