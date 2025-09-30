# Hyper Health Check

Health checks for hypercores, including prometheus support.

Checks whether the hypercore is healthy by checking how many remotes have it fully available.

## Install

`npm i -g hyper-health-check`

## Usage

With [dht-prometheus](https://gitlab.com/dcent-tech/dht-prometheus/):

```
hyper-health-check --scraper-public-key <scraper key> --scraper-secret <scraper secret> --drive <drive key> --drive <drive key2>
```

Replacing <scraper key> and <scraper secret> with those of your dht-prometheus instance, and replacing `<drive key>` and `drive key2` with the keys of two hyperdrives you want to watch (z32 or hex format).

Pipe the logs into `pino-pretty` to make them human readable.

Exposing the metrics over http (standard prometheus approach):

```
hyper-health-check --port 18830 --drive <drive key> --drive <drive key2>
```

Direct a prometheus instance to the specified port to scrape the metrics.
