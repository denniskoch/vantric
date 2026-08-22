import Guacamole from 'guacamole-common-js'

/**
 * A Guacamole tunnel that hands its credentials over as the socket's
 * FIRST FRAME.
 *
 * The library's own WebSocketTunnel appends whatever you pass to
 * connect() onto the URL as a query string, which is exactly where a
 * password must not go: query strings are what proxies, gateways and
 * access logs write down. The SSH terminal here already solved this the
 * same way, and the backend expects the same shape — one JSON frame,
 * then the protocol.
 *
 * Everything else is the ordinary contract: decode what arrives into
 * instructions for the client, encode what the client sends back.
 */
export interface GuacCredentials {
  username?: string
  password?: string
  domain?: string
}

export class FirstFrameTunnel extends Guacamole.Tunnel {
  private socket: WebSocket | null = null
  private readonly parser = new Guacamole.Parser()

  private readonly url: string
  private readonly credentials: GuacCredentials

  constructor(url: string, credentials: GuacCredentials) {
    super()
    this.url = url
    this.credentials = credentials
    this.parser.oninstruction = (opcode, args) => this.oninstruction?.(opcode, args)
  }

  connect(): void {
    this.setState(Guacamole.Tunnel.State.CONNECTING)
    const socket = new WebSocket(this.url)
    this.socket = socket

    socket.onopen = () => {
      socket.send(JSON.stringify(this.credentials))
      this.setState(Guacamole.Tunnel.State.OPEN)
    }
    socket.onmessage = (event) => this.parser.receive(String(event.data))
    socket.onclose = () => this.setState(Guacamole.Tunnel.State.CLOSED)
    socket.onerror = () => {
      // 519 is Guacamole's "upstream unavailable". The socket itself
      // never says why it failed — that's a browser rule, not a gap
      // here — so this is the honest amount of detail.
      this.onerror?.(Object.assign(new Guacamole.Status(), { code: 519, message: 'The connection closed.' }))
      this.setState(Guacamole.Tunnel.State.CLOSED)
    }
  }

  disconnect(): void {
    this.socket?.close()
    this.socket = null
    this.setState(Guacamole.Tunnel.State.CLOSED)
  }

  sendMessage(...elements: unknown[]): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    this.socket.send(encode(elements))
  }
}

/**
 * The wire format: each element is its LENGTH IN CHARACTERS, a full
 * stop, then the value, comma-separated and terminated by a semicolon.
 *
 * Characters, not bytes — the same rule the Go side pins with a test.
 * JavaScript's string length counts UTF-16 code units, which is right
 * for everything up to U+FFFF and wrong for anything above it, so the
 * count comes from spreading the string into code points.
 */
function encode(elements: unknown[]): string {
  return (
    elements
      .map((element) => {
        const value = String(element)
        return `${[...value].length}.${value}`
      })
      .join(',') + ';'
  )
}
