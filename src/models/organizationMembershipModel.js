import mongoose from "mongoose";

const organizationMembershipSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AppUser",
      required: true,
    },
    role: {
      type: String,
      enum: ["admin", "editor", "viewer"],
      default: "viewer",
    },
  },
  { timestamps: true }
);

organizationMembershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
organizationMembershipSchema.index({ userId: 1 });

const OrganizationMembershipModel = mongoose.model(
  "OrganizationMembership",
  organizationMembershipSchema
);

export default OrganizationMembershipModel;
