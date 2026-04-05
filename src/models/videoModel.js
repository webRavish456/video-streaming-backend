import mongoose from "mongoose";

const videoSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, default: "", maxlength: 2000 },

    originalFilename: { type: String, required: true },

    storedFilename: { type: String, default: "" },

    cloudinaryPublicId: { type: String, default: "" },

    videoUrl: { type: String, default: "" },

    mimeType: { type: String, required: true },
    fileSize: { type: Number, required: true, min: 0 },
    durationMs: { type: Number, default: null, min: 0 },

    processingStatus: {
      type: String,
      enum: ["uploaded", "analyzing", "ready", "failed"],
      default: "uploaded",
    },
    processingError: { type: String, default: "" },

    sensitivityStatus: {
      type: String,
      enum: ["pending", "processing", "safe", "flagged"],
      default: "pending",
    },
    sensitivityNote: { type: String, default: "" },
    sensitivityScore: { type: Number, default: null },

    
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
    },


    assignedToUsers: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "AppUser" }],
      default: [],
    },


    uploadedByUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AppUser",
      default: null,
    },
  },
  { timestamps: true }
);

videoSchema.index({ createdAt: -1 });
videoSchema.index({ sensitivityStatus: 1, processingStatus: 1 });
videoSchema.index({ cloudinaryPublicId: 1 });
videoSchema.index({ uploadedByUser: 1 });
videoSchema.index({ assignedToUsers: 1 });
videoSchema.index({ organizationId: 1, createdAt: -1 });

const VideoModel = mongoose.model("Video", videoSchema);

export default VideoModel;
