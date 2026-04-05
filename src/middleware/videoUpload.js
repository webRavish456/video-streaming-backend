import multer from "multer";
import { randomUUID } from "crypto";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import { cloudinary, isCloudinaryConfigured } from "../cloudinary.js";
import { MAX_VIDEO_BYTES, ALLOWED_MIME } from "../services/uploadValidation.js";

const cloudinaryOk = isCloudinaryConfigured;
const folder = process.env.CLOUDINARY_VIDEO_FOLDER || "streamhub-videos";
const useVideoModeration = process.env.CLOUDINARY_VIDEO_MODERATION === "true";

const AWS_REK_VIDEO_MODERATION = "aws_rek_video";

if (!cloudinaryOk) {
  console.warn(
    "[video] Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET for uploads."
  );
}

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (_req, file) => ({
    folder,
    resource_type: "video",
    public_id: `video-${Date.now()}-${randomUUID().replace(/-/g, "")}`,
    allowed_formats: ["mp4", "webm", "mov"],
    ...(useVideoModeration ? { moderation: AWS_REK_VIDEO_MODERATION } : {}),
  }),
});

function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    cb(new Error("Invalid file type. Use MP4, WebM, or MOV."));
    return;
  }
  cb(null, true);
}

export const uploadVideoMiddleware = multer({
  storage,
  limits: { fileSize: MAX_VIDEO_BYTES },
  fileFilter,
}).single("video");

export function requireCloudinaryForOrgUpload(req, res, next) {
  if (!cloudinaryOk) {
    return res.status(503).json({
      status: "error",
      message:
        "Video upload is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in the server environment.",
    });
  }
  next();
}
