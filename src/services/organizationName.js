import mongoose from "mongoose";
import OrganizationModel from "../models/organizationModel.js";

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeOrgName(input) {
  return String(input ?? "").trim().slice(0, 120);
}

export async function isOrganizationNameTaken(name, { excludeOrganizationId } = {}) {
  const label = normalizeOrgName(name);
  if (!label) return false;

  const filter = {
    name: new RegExp(`^${escapeRegex(label)}$`, "i"),
  };
  if (excludeOrganizationId && mongoose.isValidObjectId(excludeOrganizationId)) {
    filter._id = { $ne: new mongoose.Types.ObjectId(excludeOrganizationId) };
  }

  const doc = await OrganizationModel.findOne(filter).select("_id").lean();
  return Boolean(doc);
}
