import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    /** App account: org creator = admin; invited users typically viewer/editor. */
    role: {
      type: String,
      enum: ["viewer", "editor", "admin"],
      default: "viewer",
    },
  },
  { timestamps: true }
);

const UserModel = mongoose.model("AppUser", userSchema);

export default UserModel;
