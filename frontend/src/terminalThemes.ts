import type { ITheme } from '@xterm/xterm'

/**
 * Terminal colour schemes.
 *
 * A per-browser preference, so it lives in localStorage rather than the
 * database — it isn't account data, and syncing it would mean a write
 * every time somebody tries one on.
 *
 * The set is the ones people actually reach for: the console's own
 * dark and light, the two phosphors, and the four schemes that show up
 * in every terminal's presets. Each carries a full sixteen-colour
 * palette, because a theme that only sets background and foreground
 * leaves `ls` and `git diff` rendering in whatever the last theme left
 * behind.
 */
export interface TerminalTheme {
  id: string
  label: string
  theme: ITheme
}

export const terminalThemes: TerminalTheme[] = [
  {
    id: 'dark',
    label: 'Dark',
    theme: {
      background: '#202124',
      foreground: '#e8eaed',
      cursor: '#e8eaed',
      selectionBackground: '#3c4043',
      black: '#202124',
      red: '#f28b82',
      green: '#81c995',
      yellow: '#fdd663',
      blue: '#8ab4f8',
      magenta: '#c58af9',
      cyan: '#78d9ec',
      white: '#e8eaed',
      brightBlack: '#5f6368',
      brightRed: '#f6aea9',
      brightGreen: '#a8dab5',
      brightYellow: '#fde293',
      brightBlue: '#aecbfa',
      brightMagenta: '#d7aefb',
      brightCyan: '#a1e4f2',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'light',
    label: 'Light',
    theme: {
      background: '#ffffff',
      foreground: '#202124',
      cursor: '#202124',
      selectionBackground: '#d2e3fc',
      black: '#202124',
      red: '#c5221f',
      green: '#137333',
      yellow: '#b06000',
      blue: '#1967d2',
      magenta: '#8430ce',
      cyan: '#007b83',
      white: '#e8eaed',
      brightBlack: '#5f6368',
      brightRed: '#d93025',
      brightGreen: '#188038',
      brightYellow: '#e37400',
      brightBlue: '#1a73e8',
      brightMagenta: '#a142f4',
      brightCyan: '#12b5cb',
      brightWhite: '#ffffff',
    },
  },
  {
    // The one you asked for. Amber phosphor, as the monochrome CRTs
    // did it: everything is one hue at varying intensity, so the
    // sixteen slots are shades rather than colours.
    id: 'amber',
    label: 'Amber (phosphor)',
    theme: {
      background: '#1a1200',
      foreground: '#ffb000',
      cursor: '#ffb000',
      selectionBackground: '#553a00',
      black: '#1a1200',
      red: '#cc7000',
      green: '#ffb000',
      yellow: '#ffc740',
      blue: '#cc8800',
      magenta: '#e09000',
      cyan: '#ffcc66',
      white: '#ffb000',
      brightBlack: '#7a5200',
      brightRed: '#ff9500',
      brightGreen: '#ffc740',
      brightYellow: '#ffdd88',
      brightBlue: '#ffa500',
      brightMagenta: '#ffb833',
      brightCyan: '#ffe0a3',
      brightWhite: '#fff2d9',
    },
  },
  {
    // The other phosphor, and the reason amber shouldn't ship alone.
    id: 'green',
    label: 'Green (phosphor)',
    theme: {
      background: '#001100',
      foreground: '#33ff33',
      cursor: '#33ff33',
      selectionBackground: '#005500',
      black: '#001100',
      red: '#00cc00',
      green: '#33ff33',
      yellow: '#66ff66',
      blue: '#00aa00',
      magenta: '#00dd00',
      cyan: '#88ff88',
      white: '#33ff33',
      brightBlack: '#007700',
      brightRed: '#00ff00',
      brightGreen: '#66ff66',
      brightYellow: '#99ff99',
      brightBlue: '#00ee00',
      brightMagenta: '#4dff4d',
      brightCyan: '#bbffbb',
      brightWhite: '#ddffdd',
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    theme: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      selectionBackground: '#44475a',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    theme: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#93a1a1',
      selectionBackground: '#073642',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#586e75',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3',
    },
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    theme: {
      background: '#fdf6e3',
      foreground: '#657b83',
      cursor: '#586e75',
      selectionBackground: '#eee8d5',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#002b36',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3',
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    theme: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      selectionBackground: '#434c5e',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4',
    },
  },
  {
    id: 'gruvbox-dark',
    label: 'Gruvbox Dark',
    theme: {
      background: '#282828',
      foreground: '#ebdbb2',
      cursor: '#ebdbb2',
      selectionBackground: '#504945',
      black: '#282828',
      red: '#cc241d',
      green: '#98971a',
      yellow: '#d79921',
      blue: '#458588',
      magenta: '#b16286',
      cyan: '#689d6a',
      white: '#a89984',
      brightBlack: '#928374',
      brightRed: '#fb4934',
      brightGreen: '#b8bb26',
      brightYellow: '#fabd2f',
      brightBlue: '#83a598',
      brightMagenta: '#d3869b',
      brightCyan: '#8ec07c',
      brightWhite: '#ebdbb2',
    },
  },
  {
    id: 'monokai',
    label: 'Monokai',
    theme: {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f0',
      selectionBackground: '#49483e',
      black: '#272822',
      red: '#f92672',
      green: '#a6e22e',
      yellow: '#f4bf75',
      blue: '#66d9ef',
      magenta: '#ae81ff',
      cyan: '#a1efe4',
      white: '#f8f8f2',
      brightBlack: '#75715e',
      brightRed: '#f92672',
      brightGreen: '#a6e22e',
      brightYellow: '#f4bf75',
      brightBlue: '#66d9ef',
      brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4',
      brightWhite: '#f9f8f5',
    },
  },
]

const storageKey = 'vantric.terminal.theme'
const fontKey = 'vantric.terminal.fontSize'

export const defaultThemeID = 'dark'

/** The sizes offered in the picker. */
export const fontSizes = [11, 12, 13, 14, 16, 18]

export function themeFor(id: string): TerminalTheme {
  return (
    terminalThemes.find((t) => t.id === id) ??
    terminalThemes.find((t) => t.id === defaultThemeID)!
  )
}

/** The saved preference, or the default when nothing is stored. */
export function savedThemeID(): string {
  return localStorage.getItem(storageKey) ?? defaultThemeID
}

export function saveThemeID(id: string) {
  localStorage.setItem(storageKey, id)
}

export function savedFontSize(): number {
  const size = Number(localStorage.getItem(fontKey))
  return size >= 9 && size <= 24 ? size : 13
}

export function saveFontSize(size: number) {
  localStorage.setItem(fontKey, String(size))
}
