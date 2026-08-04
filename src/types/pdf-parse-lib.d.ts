// pdf-parse's main entry (`index.js`) runs a debug harness that reads a bundled
// test PDF when `module.parent` is falsy, which throws under a dynamic import.
// We import the harness-free implementation directly; declare its type here since
// @types/pdf-parse only covers the package root.
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string
    numpages: number
    numrender: number
    info: unknown
    metadata: unknown
    version: string
  }
  function pdfParse(dataBuffer: Buffer, options?: Record<string, unknown>): Promise<PdfParseResult>
  export default pdfParse
}
