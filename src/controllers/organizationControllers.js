import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import OrganizationModel from "../models/organizationModel.js";
import OrganizationMembershipModel from "../models/organizationMembershipModel.js";
import UserModel from "../models/userModel.js";
import VideoModel from "../models/videoModel.js";
import { cloudinary } from "../cloudinary.js";
import { normalizeOrgName, isOrganizationNameTaken } from "../services/organizationName.js";

const ORG_ROLES = ["admin", "editor", "viewer"];

function jsonError(res, status, message) {
  return res.status(status).json({ status: "error", message });
}

function duplicateNameResponse(res) {
  return jsonError(res, 409, "This organization name is already taken");
}

function orgNameFieldError(name) {
  if (!name) return "Organization name is required";
  if (name.length < 2) return "Organization name must be at least 2 characters";
  return null;
}

async function destroyCloudinaryVideo(publicId) {
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: "video" }).catch(() => {});
}

function normalizePhone(input) {
  return String(input ?? "").replace(/\D/g, "");
}

async function membershipsPayload(userId) {
  const uidStr = String(userId);
  const rows = await OrganizationMembershipModel.find({ userId })
    .populate("organizationId", "name createdBy")
    .sort({ createdAt: 1 })
    .lean();

  return rows
    .filter((r) => r.organizationId)
    .map((r) => {
      const o = r.organizationId;
      const createdBy = o.createdBy ? String(o.createdBy) : null;
      return {
        id: o._id.toString(),
        name: o.name,
        orgRole: r.role,
        isOrganizationCreator: Boolean(createdBy && createdBy === uidStr),
      };
    });
}

export { membershipsPayload };

function isOrgCreator(orgDoc, userId) {
  return Boolean(orgDoc?.createdBy && String(orgDoc.createdBy) === String(userId));
}

async function assertNotOrgCreator(organizationId, memberUserId, res) {
  const orgDoc = await OrganizationModel.findById(organizationId).select("createdBy").lean();
  if (isOrgCreator(orgDoc, memberUserId)) {
    jsonError(res, 403, "The organization creator cannot be edited or removed");
    return false;
  }
  return true;
}

export const listMyOrganizations = async (req, res) => {
  try {
    const organizations = await membershipsPayload(req.appUser._id);
    return res.status(200).json({ status: "success", organizations });
  } catch (e) {
    console.error("listMyOrganizations", e);
    return jsonError(res, 500, "Failed to list organizations");
  }
};

export const createMyOrganization = async (req, res) => {
  try {
    const name = normalizeOrgName(req.body?.name);
    const err = orgNameFieldError(name);
    if (err) return jsonError(res, 400, err);
    if (await isOrganizationNameTaken(name)) return duplicateNameResponse(res);

    const org = await OrganizationModel.create({
      name,
      createdBy: req.appUser._id,
    });
    await OrganizationMembershipModel.create({
      organizationId: org._id,
      userId: req.appUser._id,
      role: "admin",
    });

    return res.status(201).json({
      status: "success",
      organization: { id: org._id.toString(), name: org.name, orgRole: "admin" },
    });
  } catch (e) {
    console.error("createMyOrganization", e);
    if (e?.code === 11000) return duplicateNameResponse(res);
    return jsonError(res, 500, "Failed to create organization");
  }
};

export const patchMyOrganization = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const name = normalizeOrgName(req.body?.name);
    const err = orgNameFieldError(name);
    if (err) return jsonError(res, 400, err);
    if (await isOrganizationNameTaken(name, { excludeOrganizationId: organizationId })) {
      return duplicateNameResponse(res);
    }

    const updated = await OrganizationModel.findOneAndUpdate(
      { _id: organizationId },
      { $set: { name } },
      { new: true }
    )
      .select("name")
      .lean();

    if (!updated) return jsonError(res, 404, "Organization not found");

    return res.status(200).json({
      status: "success",
      message: "Updated",
      organization: {
        id: organizationId,
        name: updated.name,
        orgRole: req.orgMembership.role,
      },
    });
  } catch (e) {
    console.error("patchMyOrganization", e);
    if (e?.code === 11000) return duplicateNameResponse(res);
    return jsonError(res, 500, "Failed to update organization");
  }
};

export const deleteMyOrganization = async (req, res) => {
  try {
    const organizationId = req.organizationObjectId;
    const org = await OrganizationModel.findById(organizationId).select("createdBy").lean();
    if (!org) return jsonError(res, 404, "Organization not found");
    if (String(org.createdBy) !== String(req.appUser._id)) {
      return jsonError(res, 403, "Only the organization creator can delete it");
    }

    const videos = await VideoModel.find({ organizationId }).select("cloudinaryPublicId").lean();
    await Promise.all(videos.map((v) => destroyCloudinaryVideo(v.cloudinaryPublicId)));

    await VideoModel.deleteMany({ organizationId });
    await OrganizationMembershipModel.deleteMany({ organizationId });
    await OrganizationModel.deleteOne({ _id: organizationId });

    return res.status(200).json({ status: "success", message: "Organization deleted" });
  } catch (e) {
    console.error("deleteMyOrganization", e);
    return jsonError(res, 500, "Failed to delete organization");
  }
};

export const listOrganizationMembers = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const org = await OrganizationModel.findById(organizationId).select("createdBy").lean();
    const creatorId = org?.createdBy ? String(org.createdBy) : null;

    const rows = await OrganizationMembershipModel.find({ organizationId })
      .populate("userId", "name email phone")
      .sort({ createdAt: 1 })
      .lean();

    const members = rows
      .filter((r) => r.userId)
      .map((r) => {
        const uid = r.userId._id.toString();
        return {
          userId: uid,
          name: r.userId.name,
          email: r.userId.email,
          phone: r.userId.phone,
          orgRole: r.role,
          isOrganizationCreator: Boolean(creatorId && uid === creatorId),
        };
      });

    return res.status(200).json({ status: "success", members });
  } catch (e) {
    console.error("listOrganizationMembers", e);
    return jsonError(res, 500, "Failed to list members");
  }
};

async function findOrUpsertUserForOrgInvite({ name, email, phone, password }) {
  let user = await UserModel.findOne({ email });
  if (user) {
    const dupPhone = await UserModel.findOne({ phone, _id: { $ne: user._id } });
    if (dupPhone) throw Object.assign(new Error("PHONE_CONFLICT"), { code: "PHONE_CONFLICT" });
    const updates = {};
    if (user.phone !== phone) updates.phone = phone;
    if (user.name !== name) updates.name = name;
    if (Object.keys(updates).length) {
      await UserModel.updateOne({ _id: user._id }, { $set: updates });
      user = await UserModel.findById(user._id);
    }
    return user;
  }

  const phoneTaken = await UserModel.findOne({ phone });
  if (phoneTaken) throw Object.assign(new Error("PHONE_TAKEN"), { code: "PHONE_TAKEN" });

  const hashed = await bcrypt.hash(String(password), 10);
  return UserModel.create({
    name: name.slice(0, 80),
    email,
    phone,
    password: hashed,
    role: "viewer",
  });
}

export const addOrganizationMember = async (req, res) => {
  try {
    const { organizationId } = req.params;
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").toLowerCase().trim();
    const phone = normalizePhone(req.body?.phone);
    const password = req.body?.password;
    const role = String(req.body?.role || "viewer").trim();

    if (!name || !email || phone.length !== 10) {
      return jsonError(res, 400, "Name, valid email, and 10-digit phone are required");
    }
    if (!ORG_ROLES.includes(role)) return jsonError(res, 400, "Invalid role");
    if (!password || String(password).length < 6) {
      return jsonError(res, 400, "Password (min 6 characters) is required for new members");
    }

    let user;
    try {
      user = await findOrUpsertUserForOrgInvite({ name, email, phone, password });
    } catch (err) {
      if (err.code === "PHONE_CONFLICT") {
        return jsonError(res, 409, "Phone already used by another account");
      }
      if (err.code === "PHONE_TAKEN") {
        return jsonError(res, 409, "Phone number already registered");
      }
      throw err;
    }

    const already = await OrganizationMembershipModel.findOne({
      organizationId,
      userId: user._id,
    });
    if (already) {
      return jsonError(res, 409, "This user is already a member of this organization");
    }

    await OrganizationMembershipModel.create({
      organizationId,
      userId: user._id,
      role,
    });

    return res.status(201).json({
      status: "success",
      message: "Member added",
      member: {
        userId: user._id.toString(),
        name: user.name,
        email: user.email,
        phone: user.phone,
        orgRole: role,
      },
    });
  } catch (e) {
    console.error("addOrganizationMember", e);
    return jsonError(res, 500, "Failed to add member");
  }
};

async function applyMemberRoleChange({
  membership,
  organizationId,
  memberUserId,
  role,
  actingUserId,
  res,
}) {
  if (!ORG_ROLES.includes(role)) {
    jsonError(res, 400, "Invalid role");
    return false;
  }
  if (String(memberUserId) === String(actingUserId) && role !== "admin") {
    const adminCount = await OrganizationMembershipModel.countDocuments({
      organizationId,
      role: "admin",
    });
    if (adminCount <= 1) {
      jsonError(res, 400, "Cannot remove the last organization admin");
      return false;
    }
  }
  membership.role = role;
  await membership.save();
  return true;
}

async function applyMemberProfileUpdates(memberUserId, { name, email, phoneRaw }, res) {
  const targetUser = await UserModel.findById(memberUserId);
  if (!targetUser) {
    jsonError(res, 404, "User not found");
    return false;
  }

  if (email != null) {
    if (!email) {
      jsonError(res, 400, "Email cannot be empty");
      return false;
    }
    const dup = await UserModel.findOne({ email, _id: { $ne: targetUser._id } });
    if (dup) {
      jsonError(res, 409, "Email already in use");
      return false;
    }
  }

  if (phoneRaw != null) {
    if (phoneRaw.length !== 10) {
      jsonError(res, 400, "Phone must be 10 digits");
      return false;
    }
    const dup = await UserModel.findOne({ phone: phoneRaw, _id: { $ne: targetUser._id } });
    if (dup) {
      jsonError(res, 409, "Phone already in use");
      return false;
    }
  }

  const u = {};
  if (name != null) {
    if (!name) {
      jsonError(res, 400, "Name cannot be empty");
      return false;
    }
    u.name = name.slice(0, 80);
  }
  if (email != null) u.email = email;
  if (phoneRaw != null) u.phone = phoneRaw;

  if (Object.keys(u).length) {
    await UserModel.updateOne({ _id: memberUserId }, { $set: u });
  }
  return true;
}

export const patchOrganizationMember = async (req, res) => {
  try {
    const { organizationId, memberUserId } = req.params;
    if (!mongoose.isValidObjectId(memberUserId)) {
      return jsonError(res, 400, "Invalid user");
    }

    const body = req.body || {};
    const roleRaw = body.orgRole ?? body.role;
    const role =
      roleRaw != null && String(roleRaw).trim() !== "" ? String(roleRaw).trim() : null;
    const name = body.name != null ? String(body.name).trim() : null;
    const email = body.email != null ? String(body.email).toLowerCase().trim() : null;
    const phoneRaw = body.phone != null ? normalizePhone(body.phone) : null;

    if (role == null && name == null && email == null && phoneRaw == null) {
      return jsonError(res, 400, "Nothing to update");
    }

    const membership = await OrganizationMembershipModel.findOne({
      organizationId,
      userId: memberUserId,
    });
    if (!membership) return jsonError(res, 404, "Member not found");

    if (!(await assertNotOrgCreator(organizationId, memberUserId, res))) return;

    if (role != null) {
      const ok = await applyMemberRoleChange({
        membership,
        organizationId,
        memberUserId,
        role,
        actingUserId: req.appUser._id,
        res,
      });
      if (!ok) return;
    }

    if (name != null || email != null || phoneRaw != null) {
      const ok = await applyMemberProfileUpdates(memberUserId, { name, email, phoneRaw }, res);
      if (!ok) return;
    }

    const [freshUser, freshMembership] = await Promise.all([
      UserModel.findById(memberUserId).lean(),
      OrganizationMembershipModel.findOne({ organizationId, userId: memberUserId }).lean(),
    ]);

    return res.status(200).json({
      status: "success",
      message: "Updated",
      member: {
        userId: memberUserId,
        name: freshUser.name,
        email: freshUser.email,
        phone: freshUser.phone,
        orgRole: freshMembership.role,
      },
    });
  } catch (e) {
    console.error("patchOrganizationMember", e);
    return jsonError(res, 500, "Failed to update member");
  }
};

export const deleteOrganizationMember = async (req, res) => {
  try {
    const { organizationId, memberUserId } = req.params;
    if (!mongoose.isValidObjectId(memberUserId)) {
      return jsonError(res, 400, "Invalid user");
    }

    const membership = await OrganizationMembershipModel.findOne({
      organizationId,
      userId: memberUserId,
    });
    if (!membership) return jsonError(res, 404, "Member not found");

    if (!(await assertNotOrgCreator(organizationId, memberUserId, res))) return;

    if (membership.role === "admin") {
      const adminCount = await OrganizationMembershipModel.countDocuments({
        organizationId,
        role: "admin",
      });
      if (adminCount <= 1) {
        return jsonError(res, 400, "Cannot remove the last organization admin");
      }
    }

    await OrganizationMembershipModel.deleteOne({ organizationId, userId: memberUserId });
    return res.status(200).json({ status: "success", message: "Member removed" });
  } catch (e) {
    console.error("deleteOrganizationMember", e);
    return jsonError(res, 500, "Failed to remove member");
  }
};
