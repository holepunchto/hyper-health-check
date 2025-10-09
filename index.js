const ReadyResource = require('ready-resource')
const Hyperdrive = require('hyperdrive')
const IdEnc = require('hypercore-id-encoding')

class HyperHealthCheck extends ReadyResource {
  constructor(driveKeys, coreKeys, store, swarm, opts = {}) {
    super()

    this.drives = new Map()
    this.cores = new Map()
    this.store = store
    this.swarm = swarm
    this.gracePeriod = opts.gracePeriod || 0
    this.updateInterval = opts.updateInterval || 60 * 1000

    for (const [k, { name }] of driveKeys) {
      const drive = new Hyperdrive(this.store.session(), IdEnc.decode(k))
      const labelName = name
        ? `${name}:${IdEnc.normalize(k)}`
        : IdEnc.normalize(k)
      this.drives.set(labelName, { drive, last: [], interval: null })
    }

    for (const [k, { name }] of coreKeys) {
      const core = this.store.get({ key: IdEnc.decode(k) })
      const labelName = name
        ? `${name}:${IdEnc.normalize(k)}`
        : IdEnc.normalize(k)
      this.cores.set(labelName, { core, last: [], interval: null })
    }
  }

  async _open() {
    for (const value of this.drives.values()) {
      const { drive, last } = value
      await drive.ready()
      this.swarm.join(drive.discoveryKey, { server: false, client: true })
      value.interval = setInterval(() => {
        this._updateLength(drive.blobs.core, last)
      }, this.updateInterval)
    }
    for (const value of this.cores.values()) {
      const { core, last } = value
      await core.ready()
      this.swarm.join(core.discoveryKey, { server: false, client: true })
      value.interval = setInterval(() => {
        this._updateLength(core, last)
      }, this.updateInterval)
    }
  }

  async _close() {
    for (const value of this.drives.values()) {
      clearInterval(value.interval)
    }
    for (const value of this.cores.values()) {
      clearInterval(value.interval)
    }
  }

  _processMetric(extractValue) {
    const res = new Map()
    for (const [key, { drive, last }] of this.drives) {
      res.set(key, extractValue({ core: drive.blobs.core, last }))
    }
    for (const [key, { core, last }] of this.cores) {
      res.set(key, extractValue({ core, last }))
    }
    return res
  }

  _updateLength(core, last) {
    const now = Date.now()
    last.unshift({ length: core.length, at: now })

    const index = last.findIndex((item) => now - item.at > +this.gracePeriod)
    last.splice(index)
  }

  _getLength(core, last) {
    let length = core.length
    if (this.gracePeriod) {
      const now = Date.now()
      const lastLength = last.findLast(
        (item) => now - item.at <= +this.gracePeriod
      )?.length
      if (lastLength) length = lastLength
    }
    return length
  }

  getPeersOverview() {
    const extract = ({ core }) => {
      return core.peers.length
    }
    return this._processMetric(extract)
  }

  getPeersWithAllDataOverview() {
    const extract = ({ core, last }) => {
      const length = this._getLength(core, last)
      let nr = 0
      for (const peer of core.peers) {
        if (peer.remoteContiguousLength >= length) nr++
      }
      return nr
    }

    return this._processMetric(extract)
  }

  getUniqueIpsWithAllDataOverview() {
    const extract = ({ core, last }) => {
      const length = this._getLength(core, last)
      const ips = new Set()
      for (const peer of core.peers) {
        if (peer.remoteContiguousLength >= length) {
          const ip = peer.stream.rawStream?.remoteHost
          if (ip) ips.add(peer.stream.rawStream.remoteHost)
        }
      }

      return ips
    }

    return this._processMetric(extract)
  }

  registerMetrics(promClient) {
    const labelNames = ['key']
    const self = this

    new promClient.Gauge({
      // eslint-disable-line no-new
      name: 'hyper_health_peers_total',
      help: 'the amount of peers swarming this hypercore',
      labelNames,
      collect() {
        for (const [key, res] of self.getPeersOverview()) {
          this.labels({ key }).set(res)
        }
      }
    })
    new promClient.Gauge({
      // eslint-disable-line no-new
      name: 'hyper_health_peers_with_all_data_total',
      help: 'the amount of peers who fully downloaded the data',
      labelNames,
      collect() {
        for (const [key, res] of self.getPeersWithAllDataOverview()) {
          this.labels({ key }).set(res)
        }
      }
    })
    new promClient.Gauge({
      // eslint-disable-line no-new
      name: 'hyper_health_ips_with_all_data_total',
      help: 'the amount of unique ips where a peer has fully downloaded the data',
      labelNames,
      collect() {
        for (const [key, ips] of self.getUniqueIpsWithAllDataOverview()) {
          this.labels({ key }).set(ips.size)
        }
      }
    })
  }
}

module.exports = HyperHealthCheck
