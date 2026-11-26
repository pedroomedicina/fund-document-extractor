// pdf-parse is imported by its library path (see services/documentProcessor.ts).
// Reuse the package's published types for that path.
declare module 'pdf-parse/lib/pdf-parse.js' {
  import pdf from 'pdf-parse';
  export default pdf;
}
