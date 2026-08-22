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

/**
 * ITS METHODS ARE ASSIGNED, NOT DECLARED, AND THAT IS NOT A STYLE
 * CHOICE. Guacamole.Tunnel is a constructor function that sets
 * `this.connect`, `this.disconnect` and `this.sendMessage` to empty
 * stubs as OWN properties. An own property shadows a prototype method,
 * so a subclass that declares `connect()` the ordinary way has it
 * silently replaced the moment super() runs — the client then calls a
 * function that does nothing, the socket is never opened, and there is
 * no error anywhere because nothing failed. Assigning after super() is
 * what actually overrides them.
 */
export class FirstFrameTunnel extends Guacamole.Tunnel {
  private socket: WebSocket | null = null
  /** Called for every instruction that arrives, before the client sees
   *  it. The page uses it to show that the stream is alive — a desktop
   *  that draws nothing is otherwise indistinguishable from one that
   *  isn't connected. */
  onactivity: ((opcode: string) => void) | null = null
  // The client starts talking the moment connect() returns, which is
  // before the socket has opened. Held rather than dropped: what it
  // sends first is the state it expects the far end to already have.
  private pending: string[] = []

  constructor(url: string, credentials: GuacCredentials) {
    super()

    const parser = new Guacamole.Parser()
    parser.oninstruction = (opcode, args) => {
      this.onactivity?.(opcode)
      this.oninstruction?.(opcode, args)
    }

    this.connect = () => {
      this.setState(Guacamole.Tunnel.State.CONNECTING)
      const socket = new WebSocket(url)
      this.socket = socket

      socket.onopen = () => {
        // Credentials first, always: the backend reads exactly one
        // frame before it does anything else.
        socket.send(JSON.stringify(credentials))
        for (const message of this.pending) socket.send(message)
        this.pending = []
        this.setState(Guacamole.Tunnel.State.OPEN)
      }
      socket.onmessage = (event) => parser.receive(String(event.data))
      socket.onclose = () => this.setState(Guacamole.Tunnel.State.CLOSED)
      socket.onerror = () => {
        // 519 is Guacamole's "upstream unavailable". A browser never
        // says why a socket failed — that is a browser rule, not a gap
        // here — so this is the honest amount of detail.
        this.onerror?.(
          Object.assign(new Guacamole.Status(), {
            code: 519,
            message: 'The connection closed.',
          }),
        )
        this.setState(Guacamole.Tunnel.State.CLOSED)
      }
    }

    this.disconnect = () => {
      this.socket?.close()
      this.socket = null
      this.pending = []
      this.setState(Guacamole.Tunnel.State.CLOSED)
    }

    this.sendMessage = (...elements: unknown[]) => {
      const message = encode(elements)
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(message)
        return
      }
      if (this.socket) this.pending.push(message)
    }
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
