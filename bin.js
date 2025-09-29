#!/usr/bin/env node

const os = require("os");
const path = require("path");
const pino = require("pino");
const Hyperswarm = require("hyperswarm");
const Corestore = require("corestore");
const IdEnc = require("hypercore-id-encoding");
const promClient = require("prom-client");
const Hyperdrive = require("hyperdrive");
const goodbye = require("graceful-goodbye");
const { command, flag } = require("paparam");

const Server = require("./lib/server");
const HyperHealthCheck = require(".");

// We're not stateful, so fine to live in tmp
const DEFAULT_CORESTORE_LOC = path.join(
  path.resolve(os.tmpdir()),
  "hyper-health-check",
);

const runCmd = command(
  "run",
  flag(
    "--drive|-d [drivekey]",
    "Key of a Hyperdrive to monitor. Can be more than 1.",
  ).multiple(),
  flag(
    "--port|-p [port]",
    "HTTP Port to try to bind to (defaults to a random port)",
  ),
  async function ({ flags }) {
    const logger = pino({ name: "hyper-health-check" });

    const driveKeys = [];
    for (const k of flags.drive) {
      const key = IdEnc.normalize(k);
      logger.info(`Watching drive ${key}`);
      driveKeys.push(key);
    }

    const host = "127.0.0.1";
    const port = flags.port ? parseInt(flags.port) : 0;

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
    healthChecker.registerMetrics(promClient);

    const server = new Server(host, port, drives, promClient);
    goodbye(async () => {
      logger.info("Shutting down...");
      if (server.opened) await server.close();
      await swarm.destroy();
      await store.close();
    });

    server.on("request-error", (e) => {
      logger.error(`Unexpected request error: ${e.stack}`);
    });

    await healthChecker.ready();
    await server.ready();

    const address = server.server.address();
    logger.info(`HTTP server listening at ${address.address}:${address.port}`);
  },
);

const cmd = command("hyper-health-check", runCmd);

cmd.parse();
