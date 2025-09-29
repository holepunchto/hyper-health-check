# Hyper Health Check

Health checks for hypercores, including prometheus support.

Checks whether the hypercore is healthy by checking how many remotes have it fully available.

## Install

`npm i -g hyper-health-check`

## Usage

```
hyper-health-check --drive <drive key> --drive <drive key2> --port 18838
```

replacing `<drive key>` and `drive key2` with the keys of two hyperdrives you want to watch (z32 or hex format).

Pipe the logs into `pino-pretty` to make them human readable.

Direct a prometheus instance to the specified port to scrape the metrics.
