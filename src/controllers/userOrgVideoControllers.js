import mongoose from "mongoose";
import VideoModel from "../models/videoModel.js";
import { cloudinary } from "../cloudinary.js";
import { runSensitivityPipeline } from "../services/sensitivityPipeline.js";
import { emitOrgVideoProgress } from "../socket/videoProgressEvents.js";
import {
  MAX_VIDEO_BYTES,
  isAllowedExtension,
} from "../services/uploadValidation.js";
import {
  buildVideoFilter,
  serializeAdmin,
  serializePublic,
} from "./videoControllers.js";
import OrganizationMembershipModel from "../models/organizationMembershipModel.js";

async function destroyCloudinaryVideo(publicId) {
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: "video" }).catch(() => {});
}

export const listOrgVideos = async (req, res) => {
  try {
    const base = buildVideoFilter(req.query, { admin: true });
    const orgScope = { organizationId: req.organizationObjectId };
    const filter =
      Object.keys(base).length > 0 ? { $and: [base, orgScope] } : orgScope;

    const rawLimit = Number(req.query.limit);
    const limit = Math.min(
      Math.max(Number.isFinite(rawLimit) ? rawLimit : 10, 1),
      1000
    );
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const [videos, total] = await Promise.all([
      VideoModel.find(filter)
        .populate("organizationId", "name")
        .populate("uploadedByUser", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      VideoModel.countDocuments(filter),
    ]);

    return res.status(200).json({
      status: "success",
      videos: videos.map(serializeAdmin),
      total,
      limit,
      skip,
    });
  } catch (e) {
    console.error("listOrgVideos", e);
    return res.status(500).json({ status: "error", message: "Failed to list videos" });
  }
};

export const createOrgVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: "error", message: "Video file is required" });
    }

    if (!isAllowedExtension(req.file.originalname)) {
      await destroyCloudinaryVideo(req.file.filename);
      return res.status(400).json({
        status: "error",
        message: "Allowed extensions: .mp4, .webm, .mov",
      });
    }

    const title = String(req.body.title || "").trim();
    if (!title) {
      await destroyCloudinaryVideo(req.file.filename);
      return res.status(400).json({ status: "error", message: "Title is required" });
    }
    const description = String(req.body.description || "").trim();
    if (!description) {
      await destroyCloudinaryVideo(req.file.filename);
      return res.status(400).json({ status: "error", message: "Description is required" });
    }
    const secureUrl = req.file.path;
    const publicId = req.file.filename;

    const uid = req.appUser._id;
    const assignedToUsers = [uid];

    const doc = await VideoModel.create({
      title: title.slice(0, 200),
      description: description.slice(0, 2000),
      originalFilename: req.file.originalname,
      storedFilename: "",
      cloudinaryPublicId: publicId,
      videoUrl: secureUrl,
      mimeType: req.file.mimetype,
      fileSize: Number(req.file.size) || 0,
      processingStatus: "uploaded",
      sensitivityStatus: "pending",
      uploadedByUser: uid,
      assignedToUsers,
      organizationId: req.organizationObjectId,
    });

    const orgIdStr = req.organizationObjectId.toString();
    emitOrgVideoProgress(orgIdStr, {
      videoId: doc._id.toString(),
      organizationId: orgIdStr,
      title: doc.title,
      fileName: doc.originalFilename,
      phase: "upload_complete",
      uploadPercent: 100,
      processingPercent: 0,
      processingStatus: "uploaded",
      message: "Upload complete — starting processing…",
    });

    setImmediate(() => {
      runSensitivityPipeline(doc._id.toString(), {
        videoUrl: secureUrl,
        cloudinaryPublicId: publicId,
        organizationId: orgIdStr,
        originalFilename: doc.originalFilename,
        title: doc.title,
      });
    });

    const populated = await VideoModel.findById(doc._id)
      .populate("uploadedByUser", "name email")
      .lean();

    return res.status(201).json({
      status: "success",
      message: "Upload received. Processing started.",
      video: serializeAdmin(populated),
    });
  } catch (e) {
    console.error("createOrgVideo", e);
    if (req.file?.filename) {
      await destroyCloudinaryVideo(req.file.filename);
    }
    return res.status(500).json({ status: "error", message: "Upload failed" });
  }
};

/** Org members can load playback meta for org videos (excluded from public GET /videos/:id). */
export const getOrgMemberVideoWatchMeta = async (req, res) => {
  try {
    const { videoId } = req.params;
    if (!mongoose.isValidObjectId(videoId)) {
      return res.status(400).json({ status: "error", message: "Invalid id" });
    }
    const v = await VideoModel.findById(videoId).lean();
    if (!v?.organizationId) {
      return res.status(404).json({ status: "error", message: "Not found" });
    }
    const m = await OrganizationMembershipModel.findOne({
      organizationId: v.organizationId,
      userId: req.appUser._id,
    }).lean();
    if (!m) {
      return res.status(403).json({ status: "error", message: "Forbidden" });
    }
    if (v.processingStatus !== "ready") {
      return res.status(400).json({
        status: "error",
        message: "Video is not ready for playback yet.",
      });
    }
    return res.status(200).json({
      status: "success",
      video: serializePublic(v),
    });
  } catch (e) {
    console.error("getOrgMemberVideoWatchMeta", e);
    return res.status(500).json({ status: "error", message: "Failed to load video" });
  }
};

export const getOrgVideoStatus = async (req, res) => {
  try {
    const { videoId } = req.params;
    if (!mongoose.isValidObjectId(videoId)) {
      return res.status(400).json({ status: "error", message: "Invalid id" });
    }
    const v = await VideoModel.findOne({
      _id: videoId,
      organizationId: req.organizationObjectId,
    })
      .populate("uploadedByUser", "name email")
      .lean();

    if (!v) {
      return res.status(404).json({ status: "error", message: "Not found" });
    }

    return res.status(200).json({
      status: "success",
      video: serializeAdmin(v),
    });
  } catch (e) {
    console.error("getOrgVideoStatus", e);
    return res.status(500).json({ status: "error", message: "Failed to load status" });
  }
};

/** Replace org video file (new Cloudinary asset), update metadata, re-run sensitivity pipeline. */
export const replaceOrgVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: "error", message: "Video file is required" });
    }

    const { videoId } = req.params;
    if (!mongoose.isValidObjectId(videoId)) {
      await destroyCloudinaryVideo(req.file.filename);
      return res.status(400).json({ status: "error", message: "Invalid id" });
    }

    const existing = await VideoModel.findOne({
      _id: videoId,
      organizationId: req.organizationObjectId,
    }).lean();

    if (!existing) {
      await destroyCloudinaryVideo(req.file.filename);
      return res.status(404).json({ status: "error", message: "Not found" });
    }

    if (!isAllowedExtension(req.file.originalname)) {
      await destroyCloudinaryVideo(req.file.filename);
      return res.status(400).json({
        status: "error",
        message: "Allowed extensions: .mp4, .webm, .mov",
      });
    }

    const title = String(req.body.title || "").trim();
    if (!title) {
      await destroyCloudinaryVideo(req.file.filename);
      return res.status(400).json({ status: "error", message: "Title is required" });
    }
    const description = String(req.body.description || "").trim();
    if (!description) {
      await destroyCloudinaryVideo(req.file.filename);
      return res.status(400).json({ status: "error", message: "Description is required" });
    }

    const secureUrl = req.file.path;
    const publicId = req.file.filename;
    const oldPublicId = existing.cloudinaryPublicId;

    const uid = req.appUser._id;
    await VideoModel.findOneAndUpdate(
      { _id: videoId, organizationId: req.organizationObjectId },
      {
        $set: {
          title: title.slice(0, 200),
          description: description.slice(0, 2000),
          originalFilename: req.file.originalname,
          cloudinaryPublicId: publicId,
          videoUrl: secureUrl,
          mimeType: req.file.mimetype,
          fileSize: Number(req.file.size) || 0,
          processingStatus: "uploaded",
          sensitivityStatus: "pending",
          processingError: "",
          sensitivityNote: "",
          sensitivityScore: null,
          durationMs: null,
          uploadedByUser: uid,
        },
      }
    );

    await destroyCloudinaryVideo(oldPublicId);

    const populated = await VideoModel.findById(videoId)
      .populate("organizationId", "name")
      .populate("uploadedByUser", "name email")
      .lean();

    const orgIdStr = req.organizationObjectId.toString();
    emitOrgVideoProgress(orgIdStr, {
      videoId: String(videoId),
      organizationId: orgIdStr,
      title: populated.title,
      fileName: populated.originalFilename,
      phase: "upload_complete",
      uploadPercent: 100,
      processingPercent: 0,
      processingStatus: "uploaded",
      message: "Replacement uploaded — processing…",
    });

    setImmediate(() => {
      runSensitivityPipeline(String(videoId), {
        videoUrl: secureUrl,
        cloudinaryPublicId: publicId,
        organizationId: orgIdStr,
        originalFilename: populated.originalFilename,
        title: populated.title,
      });
    });

    return res.status(200).json({
      status: "success",
      message: "Video replaced. Processing started.",
      video: serializeAdmin(populated),
    });
  } catch (e) {
    console.error("replaceOrgVideo", e);
    if (req.file?.filename) {
      await destroyCloudinaryVideo(req.file.filename);
    }
    return res.status(500).json({ status: "error", message: "Replace failed" });
  }
};

export const patchOrgVideo = async (req, res) => {
  try {
    const { videoId } = req.params;
    if (!mongoose.isValidObjectId(videoId)) {
      return res.status(400).json({ status: "error", message: "Invalid id" });
    }

    const title = req.body?.title != null ? String(req.body.title).trim() : null;
    const description =
      req.body?.description != null ? String(req.body.description).trim() : null;

    if (title === null && description === null) {
      return res.status(400).json({ status: "error", message: "Nothing to update" });
    }

    const updates = {};
    if (title !== null) {
      if (!title) {
        return res.status(400).json({ status: "error", message: "Title cannot be empty" });
      }
      updates.title = title.slice(0, 200);
    }
    if (description !== null) {
      updates.description = description.slice(0, 2000);
    }

    const v = await VideoModel.findOneAndUpdate(
      { _id: videoId, organizationId: req.organizationObjectId },
      { $set: updates },
      { new: true }
    )
      .populate("organizationId", "name")
      .populate("uploadedByUser", "name email")
      .lean();

    if (!v) {
      return res.status(404).json({ status: "error", message: "Not found" });
    }

    return res.status(200).json({
      status: "success",
      message: "Updated",
      video: serializeAdmin(v),
    });
  } catch (e) {
    console.error("patchOrgVideo", e);
    return res.status(500).json({ status: "error", message: "Update failed" });
  }
};

export const deleteOrgVideo = async (req, res) => {
  try {
    const { videoId } = req.params;
    if (!mongoose.isValidObjectId(videoId)) {
      return res.status(400).json({ status: "error", message: "Invalid id" });
    }

    const v = await VideoModel.findOne({
      _id: videoId,
      organizationId: req.organizationObjectId,
    }).lean();

    if (!v) {
      return res.status(404).json({ status: "error", message: "Not found" });
    }

    await destroyCloudinaryVideo(v.cloudinaryPublicId);
    await VideoModel.deleteOne({ _id: videoId, organizationId: req.organizationObjectId });

    return res.status(200).json({ status: "success", message: "Deleted" });
  } catch (e) {
    console.error("deleteOrgVideo", e);
    return res.status(500).json({ status: "error", message: "Delete failed" });
  }
};
