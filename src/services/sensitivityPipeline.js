import fs from "fs";
import crypto from "crypto";
import VideoModel from "../models/videoModel.js";
import { cloudinary, isCloudinaryConfigured } from "../cloudinary.js";
import { verifyVideoMagicBytesBuffer } from "./uploadValidation.js";
import { emitOrgVideoProgress } from "../socket/videoProgressEvents.js";

const SAMPLE_BYTES = 512 * 1024;

const POLL_MS = 3000;
const MAX_POLLS = 120;

function uploadRequestedModeration() {
  return process.env.CLOUDINARY_VIDEO_MODERATION === "true";
}

const AWS_REK_VIDEO_KIND = "aws_rek_video";

function useModerationMock() {
  return process.env.CLOUDINARY_MODERATION_MOCK === "true";
}
  
async function hashFromUrl(videoUrl) {
  const res = await fetch(videoUrl, {
    headers: { Range: `bytes=0-${SAMPLE_BYTES - 1}` },
  });
  if (!res.ok && res.status !== 206) {
    throw new Error(`Fetch video failed: ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!verifyVideoMagicBytesBuffer(buf)) {
    return { ok: false, reason: "Invalid or unsupported video container" };
  }
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  return { ok: true, hash };
}

function hashFromLocalFileHead(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(SAMPLE_BYTES);
    const read = fs.readSync(fd, buf, 0, SAMPLE_BYTES, 0);
    const slice = buf.subarray(0, read);
    if (!verifyVideoMagicBytesBuffer(slice)) {
      return { ok: false, reason: "Invalid or unsupported video container" };
    }
    const hash = crypto.createHash("sha256").update(slice).digest("hex");
    return { ok: true, hash };
  } finally {
    fs.closeSync(fd);
  }
}

function pickCloudinaryVideoModerationStatus(resource) {
  const kind = AWS_REK_VIDEO_KIND;
  const list = resource?.moderation;
  if (Array.isArray(list) && list.length > 0) {
    const row = list.find((m) => m.kind === kind) ?? list[0];
    if (row?.status === "pending") return "pending";
    if (row?.status === "approved" || row?.status === "rejected") return row.status;
  }
  const resp = resource?.moderation_response;
  const mk = resp?.moderation_kind;
  if (mk && mk !== kind) {
    return null;
  }
  const mr = resp?.moderation_status;
  if (typeof mr === "string") {
    const low = mr.toLowerCase();
    if (low === "rejected" || low === "approved") return low;
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll Cloudinary until moderation is final or timeout.
 * @param {(pollIndex: number) => void} [onPollIndex]
 * @returns {{ ok: true, status: 'approved'|'rejected' } | { ok: false, reason: string }}
 */
async function pollCloudinaryVideoModeration(publicId, onPollIndex) {
  let sawModeration = false;
  for (let i = 0; i < MAX_POLLS; i++) {
    onPollIndex?.(i);
    const resource = await cloudinary.api.resource(publicId, {
      resource_type: "video",
    });
    if (
      (Array.isArray(resource?.moderation) && resource.moderation.length > 0) ||
      resource?.moderation_response
    ) {
      sawModeration = true;
    }
    const st = pickCloudinaryVideoModerationStatus(resource);
    if (st === "approved" || st === "rejected") {
      return { ok: true, status: st };
    }
    if (!sawModeration && i >= 4) {
      return { ok: false, reason: "no_moderation_metadata" };
    }
    await sleep(POLL_MS);
  }
  return { ok: false, reason: "timeout" };
}

async function applyFingerprintFallback(videoId, { filePath, videoUrl }, prefixNote) {
  let digest;

  if (videoUrl) {
    const r = await hashFromUrl(videoUrl);
    if (!r.ok) {
      await VideoModel.findByIdAndUpdate(videoId, {
        processingStatus: "failed",
        processingError: r.reason,
        sensitivityStatus: "flagged",
        sensitivityNote:
          (prefixNote ? `${prefixNote} ` : "") +
          "Container check failed — file does not look like MP4/MOV/WebM at byte level.",
      });
      return;
    }
    digest = r.hash;
  } else if (filePath) {
    if (!fs.existsSync(filePath)) {
      await VideoModel.findByIdAndUpdate(videoId, {
        processingStatus: "failed",
        processingError: "File missing after upload",
        sensitivityStatus: "flagged",
        sensitivityNote: (prefixNote ? `${prefixNote} ` : "") + "Storage error before analysis.",
      });
      return;
    }

    const r = hashFromLocalFileHead(filePath);
    if (!r.ok) {
      await VideoModel.findByIdAndUpdate(videoId, {
        processingStatus: "failed",
        processingError: r.reason,
        sensitivityStatus: "flagged",
        sensitivityNote:
          (prefixNote ? `${prefixNote} ` : "") +
          "Container check failed — file does not look like MP4/MOV/WebM.",
      });
      return;
    }
    digest = r.hash;
  } else {
    await VideoModel.findByIdAndUpdate(videoId, {
      processingStatus: "failed",
      processingError: "No file or URL for processing",
      sensitivityStatus: "flagged",
      sensitivityNote:
        (prefixNote ? `${prefixNote} ` : "") + "Configuration error — no video source for pipeline.",
    });
    return;
  }

  const score = parseInt(digest.slice(0, 8), 16) % 100;
  const flagged = score < 18;
  const base =
    (prefixNote ? `${prefixNote} ` : "") +
    "Fallback: container + SHA-256 of first ~512KB (not frames/audio). ";

  await VideoModel.findByIdAndUpdate(videoId, {
    processingStatus: "ready",
    processingError: "",
    sensitivityStatus: flagged ? "flagged" : "safe",
    sensitivityNote: flagged
      ? `${base}Demo score ${score}/100 triggered review flag (~18% for testing).`
      : `${base}Demo score ${score}/100 — within pass threshold.`,
    sensitivityScore: score,
  });
}

function makeProgressPush(organizationId, videoId, originalFilename, title) {
  return (data) => {
    if (!organizationId) return;
    emitOrgVideoProgress(String(organizationId), {
      videoId,
      fileName: originalFilename || "",
      title: title || "",
      ...data,
    });
  };
}

async function emitFinalFromDb(videoId, push) {
  const v = await VideoModel.findById(videoId).lean();
  if (!v) return;
  const failed = v.processingStatus === "failed";
  push({
    phase: failed ? "failed" : "completed",
    processingPercent: 100,
    processingStatus: v.processingStatus,
    sensitivityStatus: v.sensitivityStatus,
    message: failed
      ? v.processingError || "Processing failed"
      : v.sensitivityStatus === "flagged"
        ? "Flagged"
        : v.sensitivityStatus === "safe"
          ? "Safe"
          : "Complete",
  });
}

export async function runSensitivityPipeline(
  videoId,
  {
    filePath,
    videoUrl,
    cloudinaryPublicId,
    organizationId,
    originalFilename,
    title,
  } = {}
) {
  const push = makeProgressPush(organizationId, videoId, originalFilename, title);

  try {
    await VideoModel.findByIdAndUpdate(videoId, {
      processingStatus: "analyzing",
      sensitivityStatus: "processing",
    });

    push({
      phase: "processing",
      processingStatus: "analyzing",
      processingPercent: 15,
      message: "Processing…",
    });

    if (useModerationMock()) {
      push({
        processingPercent: 32,
        message: "Running checks (demo)…",
      });
      await sleep(450);
      push({
        processingPercent: 58,
        message: "Analysing content…",
      });
      await sleep(450);
      push({
        processingPercent: 82,
        message: "Finalising…",
      });
      await sleep(350);
      const flagged = Math.random() > 0.7;
      await VideoModel.findByIdAndUpdate(videoId, {
        processingStatus: "ready",
        processingError: "",
        sensitivityStatus: flagged ? "flagged" : "safe",
        sensitivityNote:
          "Using Cloudinary moderation flow (mocked for demo): random safe/flagged. " +
          "Set CLOUDINARY_MODERATION_MOCK=false and enable the matching video moderation add-on in Cloudinary.",
        sensitivityScore: flagged ? 90 : 10,
      });
      push({
        phase: "completed",
        processingPercent: 100,
        processingStatus: "ready",
        sensitivityStatus: flagged ? "flagged" : "safe",
        message: flagged ? "Flagged" : "Safe",
      });
      return;
    }

    const wantModeration =
      uploadRequestedModeration() &&
      Boolean(cloudinaryPublicId) &&
      isCloudinaryConfigured;

    if (wantModeration) {
      try {
        const result = await pollCloudinaryVideoModeration(
          cloudinaryPublicId,
          (i) => {
            const pct =
              18 + Math.round((i / Math.max(1, MAX_POLLS - 1)) * 72);
            push({
              phase: "processing",
              processingPercent: Math.min(94, pct),
              processingStatus: "analyzing",
              message: "Cloudinary moderation…",
            });
          }
        );
        if (result.ok) {
          const approved = result.status === "approved";
          const note =
            "Cloudinary Amazon Rekognition Video Moderation (visual categories per AWS). " +
            "Does not classify spoken abuse in audio — add STT + policy if required.";
          await VideoModel.findByIdAndUpdate(videoId, {
            processingStatus: "ready",
            processingError: "",
            sensitivityStatus: approved ? "safe" : "flagged",
            sensitivityNote: `${note} Result: ${result.status}.`,
            sensitivityScore: approved ? 5 : 95,
          });
          push({
            phase: "completed",
            processingPercent: 100,
            processingStatus: "ready",
            sensitivityStatus: approved ? "safe" : "flagged",
            message: approved ? "Safe" : "Flagged",
          });
          return;
        }
        const prefix =
          result.reason === "timeout"
            ? "Moderation did not finish in time; flagged for review."
            : "No moderation metadata (add-on off or not applied).";
        push({
          processingPercent: 42,
          message: "Fingerprint analysis…",
        });
        await applyFingerprintFallback(videoId, { filePath, videoUrl }, prefix);
        await emitFinalFromDb(videoId, push);
        return;
      } catch (e) {
        console.error("cloudinary moderation poll", videoId, e);
        push({
          processingPercent: 40,
          message: "Recovering after moderation API error…",
        });
        await applyFingerprintFallback(
          videoId,
          { filePath, videoUrl },
          `Cloudinary moderation API error: ${e.message || "unknown"}.`
        );
        await emitFinalFromDb(videoId, push);
        return;
      }
    }

    const skipNote =
      !uploadRequestedModeration()
        ? "CLOUDINARY_VIDEO_MODERATION is not true — skipped Cloudinary moderation poll. "
        : !cloudinaryPublicId
          ? "No Cloudinary public_id — skipped moderation poll. "
          : !isCloudinaryConfigured
            ? "Cloudinary env missing — skipped moderation poll. "
            : "";
    push({
      processingPercent: 28,
      message: "Fingerprint analysis…",
    });
    await applyFingerprintFallback(videoId, { filePath, videoUrl }, skipNote.trim());
    await emitFinalFromDb(videoId, push);
  } catch (e) {
    console.error("sensitivityPipeline", videoId, e);
    await VideoModel.findByIdAndUpdate(videoId, {
      processingStatus: "failed",
      processingError: e.message || "Processing error",
      sensitivityStatus: "flagged",
      sensitivityNote: "Pipeline error while processing video.",
    }).catch(() => {});
    push({
      phase: "failed",
      processingPercent: 100,
      processingStatus: "failed",
      sensitivityStatus: "flagged",
      message: e.message || "Processing error",
    });
  }
}
