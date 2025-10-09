const ReadyResource = require('ready-resource')
const http = require('http')
const listen = require('listen-async')

class HyperHealthServer extends ReadyResource {
  constructor(host, port, drives, promClient) {
    super()
    this.host = host
    this.port = port
    this.server = http.createServer()
    this.drives = drives
    this.promClient = promClient

    this.server.on('request', this._onRequest.bind(this))
  }

  async _open() {
    // Will throw if the port is not 0 and it is in use
    await listen(this.server, this.port, this.host)
  }

  async _close() {
    await new Promise((resolve) => {
      this.server.close(resolve)
    })
  }

  async _onRequest(req, res) {
    if (req.method !== 'HEAD' && req.method !== 'GET') {
      req.socket.destroy()
      res.statusCode = 400
      res.end()
      return
    }

    if (req.url !== '/metrics') {
      res.statusCode = 404
      res.end()
      return
    }

    let responseTxt = null
    let error = null
    try {
      responseTxt = await this.promClient.register.metrics()
    } catch (e) {
      this.emit('request-error', e)
      error = e
    }

    if (error) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'text/plain')
      res.end('Unexpected error. Check the server logs.')
      return
    }

    res.setHeader('Content-Type', 'text/plain')
    res.statusCode = 200
    res.end(responseTxt)
  }
}

module.exports = HyperHealthServer
