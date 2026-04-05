import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import UserModel from "../models/userModel.js";
import OrganizationMembershipModel from "../models/organizationMembershipModel.js";

export async function verifyAppUserToken(req, res, next) {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ status: "error", message: "No token provided" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.tokenType === "admin") {
      return res.status(403).json({
        status: "error",
        message: "Sign in with your StreamHub user account (not the admin panel login).",
      });
    }
    const user = await UserModel.findById(decoded.userId || decoded.id);
    if (!user) {
      return res.status(401).json({ status: "error", message: "Invalid token" });
    }
    req.appUser = user;
    next();
  } catch {
    return res.status(401).json({ status: "error", message: "Invalid token" });
  }
}

export async function loadOrgMembershipParam(req, res, next) {
  try {
    const { organizationId } = req.params;
    if (!mongoose.isValidObjectId(organizationId)) {
      return res.status(400).json({ status: "error", message: "Invalid organization" });
    }
    const m = await OrganizationMembershipModel.findOne({
      organizationId,
      userId: req.appUser._id,
    }).lean();
    if (!m) {
      return res.status(403).json({
        status: "error",
        message: "You are not a member of this organization",
      });
    }
    req.orgMembership = m;
    req.organizationObjectId = new mongoose.Types.ObjectId(organizationId);
    next();
  } catch (e) {
    console.error("loadOrgMembershipParam", e);
    return res.status(500).json({ status: "error", message: "Server error" });
  }
}

export function requireOrgRoles(...roles) {
  return (req, res, next) => {
    if (!req.orgMembership || !roles.includes(req.orgMembership.role)) {
      return res.status(403).json({
        status: "error",
        message: "Your role in this organization does not allow this action",
      });
    }
    next();
  };
}
