#!/usr/bin/env node

const os = require("os");
const path = require("path");
const pino = require("pino");
const Hyperswarm = require("hyperswarm");
const Corestore = require("corestore");
const IdEnc = require("hypercore-id-encoding");
const promClient = require("prom-client");
const goodbye = require("graceful-goodbye");
const { command, flag } = require("paparam");
const Instrumentation = require("hyper-instrument");

const Server = require("./lib/server");
const HyperHealthCheck = require(".");

// We're not stateful, so fine to live in tmp
const DEFAULT_CORESTORE_LOC = path.join(
  path.resolve(os.tmpdir()),
  "hyper-health-check",
);
const DEFAULT_LOG_INTERVAL = 60 * 60;

const runCmd = command(
  "run",
  flag(
    "--drive|-d [drivekey]",
    "Key of a Hyperdrive to monitor. Optionally include a name after the key, separated by a colon (:). Can be more than 1.",
  ).multiple(),
  flag(
    "--port|-p [port]",
    "HTTP Port to try to bind to (defaults to a random port)",
  ),
  flag(
    "--scraper-public-key [scraper-public-key]",
    "Public key of a dht-prometheus scraper.  Can be hex or z32.",
  ),
  flag(
    "--scraper-secret [scraper-secret]",
    "Secret of the dht-prometheus scraper.  Can be hex or z32.",
  ),
  flag(
    "--scraper-alias [scraper-alias]",
    "(optional) Alias with which to register to the scraper",
  ),
  flag(
    "--log-interval [logInterval]",
    `Interval (in seconds) at which to log the info. Default ${DEFAULT_LOG_INTERVAL}`,
  ),

  async function ({ flags }) {
    const logger = pino({ name: "hyper-health-check" });
    const logIntervalMs = (flags.logInterval || DEFAULT_LOG_INTERVAL) * 1000;

    const driveKeys = new Map();
    for (const entry of flags.drive) {
      const nameStart = entry.indexOf(":");
      const [k, name] =
        nameStart > 0
          ? [entry.slice(0, nameStart), entry.slice(nameStart + 1)]
          : [entry, null];
      const key = IdEnc.normalize(k);
      logger.info(`Watching drive ${key} (${name ? name : ""})`);
      driveKeys.set(key, { name });
    }

    const host = "127.0.0.1";
    const port = flags.port !== undefined ? parseInt(flags.port) : null;

    const store = new Corestore(DEFAULT_CORESTORE_LOC);
    const swarm = new Hyperswarm();
    const drives = new Map();

    swarm.on("connection", (socket, peerInfo) => {
      const peerKey = IdEnc.normalize(peerInfo.publicKey);
      logger.info(
        `connected to peer ${peerKey} (total: ${swarm.connections.size})`,
      );
      store.replicate(socket);
      socket.on("error", (e) => logger.info(e)); // Usually just unexpectedly closed
      socket.on("close", () =>
        logger.info(
          `closed connection to ${peerKey} (total: ${swarm.connections.size})`,
        ),
      );
    });

    const healthChecker = new HyperHealthCheck(driveKeys, store, swarm);

    let server = null;
    if (port !== null) {
      logger.info("Setting up HTTP server");
      server = new Server(host, port, drives, promClient);
      server.on("request-error", (e) => {
        logger.error(`Unexpected request error: ${e.stack}`);
      });
    }

    let instrumentation = null;
    if (flags.scraperPublicKey) {
      logger.info("Setting up instrumentation");

      const scraperPublicKey = IdEnc.decode(flags.scraperPublicKey);
      const scraperSecret = IdEnc.decode(flags.scraperSecret);

      let prometheusAlias = flags.scraperAlias;
      if (prometheusAlias && prometheusAlias.length > 99)
        throw new Error("The Prometheus alias must have length less than 100");
      if (!prometheusAlias) {
        prometheusAlias = `hyper-health-check-${os.hostname()}`.slice(0, 99);
      }

      instrumentation = new Instrumentation({
        swarm,
        corestore: store,
        scraperPublicKey,
        prometheusAlias,
        scraperSecret,
        prometheusServiceName: "hyper-health-check",
      });

      instrumentation.registerLogger(logger);
    }

    healthChecker.registerMetrics(promClient);

    goodbye(async () => {
      logger.info("Shutting down...");
      if (instrumentation) await instrumentation.close();
      if (server?.opened) await server.close();
      await swarm.destroy();
      await store.close();
    });

    if (instrumentation) await instrumentation.ready();
    await healthChecker.ready();
    if (server) await server.ready();

    if (server) {
      const address = server.server.address();
      logger.info(
        `HTTP server listening at ${address.address}:${address.port}`,
      );
    }

    setInterval(() => {
      const allDataPeers = healthChecker.getPeersWithAllDataOverview();
      const peers = healthChecker.getPeersOverview();
      const ipOverview = healthChecker.getUniqueIpsWithAllDataOverview();
      for (const key of allDataPeers.keys()) {
        const ips = [...ipOverview.get(key)].sort();
        logger.info(
          `${key} has ${peers.get(key)} peers, ${allDataPeers.get(key)} who fully downloaded it across ${ips.length} ip's: ${ips.join(", ")}`,
        );
      }
    }, logIntervalMs);
  },
);

const cmd = command("hyper-health-check", runCmd);

cmd.parse();
