import fs from "fs";

export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB

export const ALLOWED_MIME = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

const ALLOWED_EXT = new Set([".mp4", ".webm", ".mov"]);

export function isAllowedExtension(filename) {
  const lower = String(filename).toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return ALLOWED_EXT.has(lower.slice(dot));
}


export function verifyVideoMagicBytesBuffer(buf) {
  if (!buf || buf.length < 12) return false;
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    return true;
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return true;
  }
  return false;
}

export function verifyVideoMagicBytes(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    return verifyVideoMagicBytesBuffer(buf);
  } finally {
    fs.closeSync(fd);
  }
}
