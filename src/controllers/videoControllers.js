import mongoose from "mongoose";
import VideoModel from "../models/videoModel.js";
import { cloudinary } from "../cloudinary.js";
import { MAX_VIDEO_BYTES } from "../services/uploadValidation.js";
import multer from "multer";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildVideoFilter(query, { admin }) {
  const f = {};

  if (!admin) {
    f.processingStatus = "ready";
    f.sensitivityStatus = "safe";
  } else {
    if (query.safety && ["safe", "flagged", "pending", "processing"].includes(query.safety)) {
      f.sensitivityStatus = query.safety;
    }
    if (
      query.processing &&
      ["uploaded", "analyzing", "ready", "failed"].includes(query.processing)
    ) {
      f.processingStatus = query.processing;
    }
  }

  if (query.q?.trim()) {
    const rx = new RegExp(escapeRegex(query.q.trim()), "i");
    f.$or = [{ title: rx }, { description: rx }];
  }

  if (query.dateFrom || query.dateTo) {
    f.createdAt = {};
    if (query.dateFrom) {
      const d = new Date(query.dateFrom);
      if (!Number.isNaN(d.getTime())) f.createdAt.$gte = d;
    }
    if (query.dateTo) {
      const d = new Date(query.dateTo);
      if (!Number.isNaN(d.getTime())) f.createdAt.$lte = d;
    }
    if (Object.keys(f.createdAt).length === 0) delete f.createdAt;
  }

  if (query.minSize != null && query.minSize !== "") {
    const n = Number(query.minSize);
    if (!Number.isNaN(n)) f.fileSize = { ...f.fileSize, $gte: n };
  }
  if (query.maxSize != null && query.maxSize !== "") {
    const n = Number(query.maxSize);
    if (!Number.isNaN(n)) f.fileSize = { ...f.fileSize, $lte: n };
  }

  if (query.minDuration != null && query.minDuration !== "") {
    const n = Number(query.minDuration);
    if (!Number.isNaN(n)) f.durationMs = { ...f.durationMs, $gte: n };
  }
  if (query.maxDuration != null && query.maxDuration !== "") {
    const n = Number(query.maxDuration);
    if (!Number.isNaN(n)) f.durationMs = { ...f.durationMs, $lte: n };
  }

  return f;
}

function videoThumbnailUrl(v) {
  const pid = v.cloudinaryPublicId;
  if (!pid) return null;
  try {
    return cloudinary.utils.video_thumbnail_url(pid, {
      resource_type: "video",
      width: 400,
      height: 225,
      crop: "fill",
    });
  } catch {
    return null;
  }
}

function organizationField(v) {
  const o = v.organizationId;
  if (o && typeof o === "object" && o._id) {
    return { id: o._id.toString(), name: o.name };
  }
  if (v.organizationId && mongoose.isValidObjectId(v.organizationId)) {
    return { id: String(v.organizationId), name: null };
  }
  return null;
}

function uploaderFields(v) {
  const u = v.uploadedByUser;
  return {
    uploadedByUser:
      u && typeof u === "object" && u._id
        ? { id: u._id.toString(), name: u.name, email: u.email }
        : null,
  };
}

export function serializePublic(v) {
  return {
    id: v._id.toString(),
    title: v.title,
    description: v.description,
    organizationId: v.organizationId ? String(v.organizationId) : null,
    durationMs: v.durationMs,
    fileSize: v.fileSize,
    mimeType: v.mimeType,
    createdAt: v.createdAt,
    playbackUrl: v.videoUrl || null,
    thumbnailUrl: videoThumbnailUrl(v),
  };
}

export function serializeAdmin(v) {
  return {
    ...serializePublic(v),
    organization: organizationField(v),
    processingStatus: v.processingStatus,
    sensitivityStatus: v.sensitivityStatus,
    sensitivityNote: v.sensitivityNote,
    sensitivityScore: v.sensitivityScore,
    processingError: v.processingError,
    originalFilename: v.originalFilename,
    mimeType: v.mimeType,
    updatedAt: v.updatedAt,
    assignedToUserIds: (v.assignedToUsers || []).map((x) =>
      typeof x === "object" && x?._id ? x._id.toString() : String(x)
    ),
    ...uploaderFields(v),
  };
}

export const listPublicVideos = async (req, res) => {
  try {
    const base = buildVideoFilter(req.query, { admin: false });
    const orgPublic = {
      $or: [{ organizationId: null }, { organizationId: { $exists: false } }],
    };
    const filter =
      Object.keys(base).length > 0 ? { $and: [base, orgPublic] } : orgPublic;
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const videos = await VideoModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    return res.status(200).json({
      status: "success",
      videos: videos.map(serializePublic),
    });
  } catch (e) {
    console.error("listPublicVideos", e);
    return res.status(500).json({ status: "error", message: "Failed to list videos" });
  }
};

export const getPublicVideoMeta = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ status: "error", message: "Invalid id" });
    }
    const v = await VideoModel.findOne({
      $and: [
        { _id: id, processingStatus: "ready", sensitivityStatus: "safe" },
        {
          $or: [{ organizationId: null }, { organizationId: { $exists: false } }],
        },
      ],
    }).lean();
    if (!v) {
      return res.status(404).json({ status: "error", message: "Video not found" });
    }
    return res.status(200).json({ status: "success", video: serializePublic(v) });
  } catch (e) {
    console.error("getPublicVideoMeta", e);
    return res.status(500).json({ status: "error", message: "Failed to load video" });
  }
};

export function formatUploadErrorMessage(err) {
  if (err == null) return "Upload failed";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || "Upload failed";
  if (typeof err.message === "string" && err.message) return err.message;
  const nested = err.error;
  if (nested && typeof nested === "object") {
    if (typeof nested.message === "string") return nested.message;
  }
  if (typeof err.http_code === "number") {
    return (
      err.message || `Cloudinary rejected the upload (HTTP ${err.http_code}).`
    );
  }
  try {
    const s = JSON.stringify(err);
    if (s && s !== "{}") return s.slice(0, 500);
  } catch {
    /* ignore */
  }
  return "Upload failed";
}

export const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        status: "error",
        message: `File too large (max ${MAX_VIDEO_BYTES / (1024 * 1024)} MB)`,
      });
    }
    return res.status(400).json({ status: "error", message: err.message });
  }
  if (err?.message?.includes("Invalid file type")) {
    return res.status(400).json({ status: "error", message: err.message });
  }
  console.error("handleUploadError", err);
  return res.status(500).json({
    status: "error",
    message: formatUploadErrorMessage(err),
  });
};

export const streamVideo = async (req, res) => {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");

  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).end();
    }
    const v = await VideoModel.findOne({
      $and: [
        { _id: id, processingStatus: "ready", sensitivityStatus: "safe" },
        {
          $or: [{ organizationId: null }, { organizationId: { $exists: false } }],
        },
      ],
    }).lean();
    if (!v || !v.videoUrl) {
      return res.status(404).end();
    }
    return res.redirect(302, v.videoUrl);
  } catch (e) {
    console.error("streamVideo", e);
    if (!res.headersSent) res.status(500).end();
  }
};

export const streamVideoOptions = (_req, res) => {
  const origin = _req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Range");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.status(204).end();
};
