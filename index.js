const ReadyResource = require("ready-resource");
const Hyperdrive = require("hyperdrive");
const IdEnc = require("hypercore-id-encoding");

class HyperHealthCheck extends ReadyResource {
  constructor(driveKeys, store, swarm) {
    super();

    this.drives = new Map();
    this.store = store;
    this.swarm = swarm;

    for (const k of driveKeys) {
      const drive = new Hyperdrive(this.store.session(), IdEnc.decode(k));
      this.drives.set(k, drive);
    }
  }

  async _open() {
    for (const drive of this.drives.values()) {
      await drive.ready();
      this.swarm.join(drive.discoveryKey, { server: false, client: true });
    }
  }

  async _close() {}

  getPeersOverview() {
    const res = new Map();
    for (const [key, drive] of this.drives) {
      res.set(key, drive.db.core.peers.length);
    }

    return res;
  }

  getPeersWithAllDataOverview() {
    const res = new Map();
    for (const [key, drive] of this.drives) {
      const blobsLength = drive.blobs.core.length;
      let nr = 0;
      for (const peer of drive.blobs.core.peers) {
        // We only check the blobs core, assuming that if the blobs core is fully downloaded, the db core will always be too
        if (peer.remoteContiguousLength >= blobsLength) nr++;
      }
      res.set(key, nr);
    }

    return res;
  }

  getUniqueIpsWithAllDataOverview() {
    const res = new Map();
    for (const [key, drive] of this.drives) {
      const blobsLength = drive.blobs.core.length;
      const ips = new Set();
      for (const peer of drive.blobs.core.peers) {
        // We only check the blobs core, assuming that if the blobs core is fully downloaded, the db core will always be too
        if (peer.remoteContiguousLength >= blobsLength) {
          const ip = peer.stream.rawStream?.remoteHost;
          if (ip) ips.add(peer.stream.rawStream.remoteHost);
        }
      }
      res.set(key, ips);
    }

    return res;
  }

  registerMetrics(promClient) {
    const labelNames = ["key"];
    const self = this;

    new promClient.Gauge({
      // eslint-disable-line no-new
      name: "hyper_health_peers_total",
      help: "the amount of peers swarming this hypercore",
      labelNames,
      collect() {
        for (const [key, res] of self.getPeersOverview()) {
          this.labels({ key }).set(res);
        }
      },
    });
    new promClient.Gauge({
      // eslint-disable-line no-new
      name: "hyper_health_peers_with_all_data_total",
      help: "the amount of peers who fully downloaded the data",
      labelNames,
      collect() {
        for (const [key, res] of self.getPeersWithAllDataOverview()) {
          this.labels({ key }).set(res);
        }
      },
    });
    new promClient.Gauge({
      // eslint-disable-line no-new
      name: "hyper_health_ips_with_all_data_total",
      help: "the amount of unique ips where a peer has fully downloaded the data",
      labelNames,
      collect() {
        for (const [key, ips] of self.getUniqueIpsWithAllDataOverview()) {
          this.labels({ key }).set(ips.size);
        }
      },
    });
  }
}

module.exports = HyperHealthCheck;
