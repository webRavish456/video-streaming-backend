import mongoose from "mongoose";

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AppUser",
      required: true,
    },
  },
  { timestamps: true }
);

organizationSchema.index({ createdBy: 1 });
organizationSchema.index({ name: 1 }, { unique: true });

const OrganizationModel = mongoose.model("Organization", organizationSchema);

export default OrganizationModel;
