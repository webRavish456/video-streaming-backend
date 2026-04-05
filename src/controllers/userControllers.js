import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import UserModel from "../models/userModel.js";
import OrganizationModel from "../models/organizationModel.js";
import OrganizationMembershipModel from "../models/organizationMembershipModel.js";
import { membershipsPayload } from "./organizationControllers.js";
import {
  normalizeOrgName,
  isOrganizationNameTaken,
} from "../services/organizationName.js";

const secretKey = process.env.JWT_SECRET;

function normalizePhone(input) {
  return String(input ?? "").replace(/\D/g, "");
}

function parseLoginIdentifier(identifier) {
  const raw = String(identifier ?? "").trim();
  if (!raw) return { type: null, value: "" };
  if (raw.includes("@")) {
    return { type: "email", value: raw.toLowerCase() };
  }
  return { type: "phone", value: normalizePhone(raw) };
}

export const registerUser = async (req, res) => {
  try {
    const { name, email, password, phone, organizationName } = req.body;

    if (!name?.trim() || !email?.trim() || !password || !phone) {
      return res.status(400).json({
        status: "error",
        message: "Name, email, phone and password are required",
      });
    }

    const orgLabel = normalizeOrgName(organizationName);
    if (!orgLabel) {
      return res.status(400).json({
        status: "error",
        message: "Organization name is required",
      });
    }
    if (orgLabel.length < 2) {
      return res.status(400).json({
        status: "error",
        message: "Organization name must be at least 2 characters",
      });
    }
    if (await isOrganizationNameTaken(orgLabel)) {
      return res.status(409).json({
        status: "error",
        message: "This organization name is already taken",
      });
    }

    const phoneDigits = normalizePhone(phone);
    if (phoneDigits.length !== 10) {
      return res.status(400).json({
        status: "error",
        message: "Phone number must be exactly 10 digits",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        status: "error",
        message: "Password must be at least 6 characters",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const emailTaken = await UserModel.findOne({ email: normalizedEmail });
    if (emailTaken) {
      return res.status(409).json({ status: "error", message: "Email already registered" });
    }

    const phoneTaken = await UserModel.findOne({ phone: phoneDigits });
    if (phoneTaken) {
      return res.status(409).json({ status: "error", message: "Phone number already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await UserModel.create({
      name: name.trim(),
      email: normalizedEmail,
      phone: phoneDigits,
      password: hashedPassword,
      role: "admin",
    });

    const org = await OrganizationModel.create({
      name: orgLabel,
      createdBy: user._id,
    });
    await OrganizationMembershipModel.create({
      organizationId: org._id,
      userId: user._id,
      role: "admin",
    });

    return res.status(201).json({
      status: "success",
      message: "Account created. You can log in now.",
    });
  } catch (error) {
    console.error("registerUser:", error);
    if (error?.code === 11000) {
      return res.status(409).json({
        status: "error",
        message: "This organization name is already taken",
      });
    }
    return res.status(500).json({ status: "error", message: "Registration failed" });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { password, identifier, email } = req.body;
    const loginId = identifier ?? email;

    if (!loginId?.trim() || !password) {
      return res.status(400).json({
        status: "error",
        message: "Email or phone and password are required",
      });
    }

    const parsed = parseLoginIdentifier(loginId);
    let user = null;

    if (parsed.type === "email") {
      user = await UserModel.findOne({ email: parsed.value });
    } else if (parsed.type === "phone") {
      if (parsed.value.length !== 10) {
        return res.status(400).json({
          status: "error",
          message: "Phone number must be exactly 10 digits",
        });
      }
      user = await UserModel.findOne({ phone: parsed.value });
    } else {
      return res.status(400).json({
        status: "error",
        message: "Enter a valid email or phone number",
      });
    }

    if (!user) {
      return res.status(401).json({ status: "error", message: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ status: "error", message: "Invalid credentials" });
    }

    const appRole = user.role || "viewer";
    const access_token = jwt.sign(
      {
        userId: user._id.toString(),
        email: user.email,
        tokenType: "user",
        appRole,
      },
      secretKey,
      { expiresIn: "28d" }
    );

    const organizations = await membershipsPayload(user._id);
    const activeOrganizationId = organizations[0]?.id ?? null;

    return res.status(200).json({
      status: "success",
      message: "Login successful",
      access_token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: appRole,
        organizations,
        activeOrganizationId,
      },
    });
  } catch (error) {
    console.error("loginUser:", error);
    return res.status(500).json({ status: "error", message: "Login failed" });
  }
};
