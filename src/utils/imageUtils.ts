
import { PixelCrop } from "react-image-crop";

/* ------------------------------------------------------------------ */
/* 🌐 CORS-safe image loading                                          */
/* ------------------------------------------------------------------ */

/**
 * Appends a `_cors=1` query param to remote URLs so Cloudflare R2 creates
 * a separate CDN cache entry that is always fetched from origin with CORS
 * headers.  Without this, R2 may return a cached 304 that omits the
 * `Access-Control-Allow-Origin` header, tainting the canvas.
 *
 * Data URLs and blob URLs are returned unchanged.
 */
export function withCORSParam(url: string): string {
    if (!url || url.startsWith("data:") || url.startsWith("blob:")) return url;
    return url + (url.includes("?") ? "&" : "?") + "_cors=1";
}

/**
 * Loads a remote image with `crossOrigin = "anonymous"` and a CORS cache-
 * buster param.  Use this wherever the resulting image will be drawn onto a
 * `<canvas>` (drawImage / toBlob / toDataURL).
 */
export function loadCORSImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = withCORSParam(src);
    });
}

/* ------------------------------------------------------------------ */
/* ✂️ Image Cropping Helper */
/* ------------------------------------------------------------------ */
export function getCroppedImg(
    image: HTMLImageElement,
    crop: PixelCrop,
    fileName: string
): Promise<File> {
    const canvas = document.createElement("canvas");
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    canvas.width = crop.width * scaleX;
    canvas.height = crop.height * scaleY;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
        throw new Error("No 2d context");
    }

    ctx.drawImage(
        image,
        crop.x * scaleX,
        crop.y * scaleY,
        crop.width * scaleX,
        crop.height * scaleY,
        0,
        0,
        canvas.width,
        canvas.height
    );

    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error("Canvas is empty"));
                return;
            }
            const file = new File([blob], fileName, { type: "image/png" });
            resolve(file);
        }, "image/png");
    });
}
