/// <reference types="vite/client" />

// Markdown imported with `?raw` arrives as a string. Vite knows this at
// build time; TypeScript needs telling.
declare module '*.md?raw' {
  const content: string
  export default content
}
