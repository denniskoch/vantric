/**
 * Types for guacamole-common-js, which ships none.
 *
 * DELIBERATELY NARROW: only what this console calls, rather than a
 * transcription of the whole library. A hand-written declaration is a
 * second copy of somebody else's API and goes stale silently — the
 * smaller it is, the less of it can be wrong, and anything missing
 * announces itself as a compile error rather than as a lie.
 *
 * ONE DEFAULT EXPORT, which is how the package actually ships: its ESM
 * build ends `export default Guacamole` and names nothing else.
 * Declaring named exports typechecked perfectly and failed at bundle
 * time, because a declaration file cannot be wrong about a library —
 * it IS the library as far as tsc is concerned. The bundler is the
 * only thing here that reads the real one.
 */
declare module 'guacamole-common-js' {
  namespace Guacamole {
    class Status {
      code: number
      message?: string
    }

    /** Decodes the instruction stream. Used to implement a tunnel. */
    class Parser {
      receive(text: string, isBuffer?: boolean): void
      oninstruction: ((opcode: string, args: string[]) => void) | null
    }

    /** The interface a tunnel implements; see FirstFrameTunnel. */
    class Tunnel {
      static readonly State: {
        CONNECTING: number
        OPEN: number
        CLOSED: number
        UNSTABLE: number
      }
      connect(data?: string): void
      disconnect(): void
      sendMessage(...elements: unknown[]): void
      setState(state: number): void
      isConnected(): boolean
      oninstruction: ((opcode: string, args: string[]) => void) | null
      onerror: ((status: Status) => void) | null
      onstatechange: ((state: number) => void) | null
      uuid: string | null
    }

    class Display {
      getElement(): HTMLElement
      getWidth(): number
      getHeight(): number
      scale(scale: number): void
      onresize: ((width: number, height: number) => void) | null
    }

    class Client {
      constructor(tunnel: Tunnel)
      connect(data?: string): void
      disconnect(): void
      getDisplay(): Display
      sendMouseState(state: MouseState): void
      sendKeyEvent(pressed: number, keysym: number): void
      sendSize(width: number, height: number): void
      onerror: ((status: Status) => void) | null
      onstatechange: ((state: number) => void) | null
      onname: ((name: string) => void) | null
    }

    interface MouseState {
      x: number
      y: number
      left: boolean
      middle: boolean
      right: boolean
      up: boolean
      down: boolean
    }

    class Mouse {
      constructor(element: HTMLElement)
      onmousedown: ((state: MouseState) => void) | null
      onmouseup: ((state: MouseState) => void) | null
      onmousemove: ((state: MouseState) => void) | null
      onmouseout: (() => void) | null
    }

    class Keyboard {
      constructor(element: HTMLElement | Document)
      onkeydown: ((keysym: number) => boolean | void) | null
      onkeyup: ((keysym: number) => void) | null
      reset(): void
    }
  }

  export default Guacamole
}
