/**
 * One-shot PDF → PNG rasterization helper for the Image Underlay flow.
 *
 * Path (a) from the discussion: render the first page of a PDF to a high-DPI
 * off-screen canvas, then return a PNG data URL that drops straight into
 * `imageUnderlay.src`. Resolution preserved up to the rasterization DPI;
 * beyond that, the user will see pixelation when zooming in.
 *
 * pdf.js worker is loaded lazily via the `?url` Vite import (same pattern as
 * `src/pages/ImageAnnotation.tsx`) so the editor's initial bundle isn't
 * bloated by ~1.2MB of worker code unless someone actually opens a PDF.
 */

let workerInitialized = false;

/** Lazy-init pdf.js + its worker URL the first time we rasterize. */
const loadPdfjs = async () => {
  const [pdfjsLib, workerUrlModule] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  if (!workerInitialized) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrlModule.default;
    workerInitialized = true;
  }
  return pdfjsLib;
};

/**
 * Render the first page of `file` to a PNG data URL at the requested DPI.
 *
 * Default 300 DPI gives crisp output at moderate zoom levels and is the
 * common choice for print-quality PDF rasterization. The resulting PNG can
 * be wired straight into the existing `imageUnderlay.src` slot — no other
 * changes downstream (positioning, calibration, opacity) are required.
 */
export const rasterizePdfFirstPage = async (file: File, dpi = 300): Promise<{
  dataUrl: string;
  widthPx: number;
  heightPx: number;
}> => {
  const pdfjsLib = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  try {
    const page = await pdf.getPage(1);
    // PDF dimensions are in points (1pt = 1/72 inch). scale = dpi / 72 maps
    // those points to the requested pixel resolution.
    const scale = dpi / 72;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D canvas context for PDF raster");
    // White background so transparent PDFs read as a clean overlay rather than
    // showing the canvas-default black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const dataUrl = canvas.toDataURL("image/png");
    return { dataUrl, widthPx: canvas.width, heightPx: canvas.height };
  } finally {
    // Release the PDFDocumentProxy so its WebAssembly memory / worker handles
    // can be GC'd promptly. We only ever wanted page 1.
    await pdf.destroy();
  }
};
