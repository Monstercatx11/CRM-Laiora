// The explicit browser build uses the same API/types as the package entry point.
declare module 'pdfjs-dist/build/pdf.mjs' {
  export * from 'pdfjs-dist';
}
