import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import UserModel from "../models/userModel.js";
import OrganizationMembershipModel from "../models/organizationMembershipModel.js";
import { setSocketIo } from "./videoProgressEvents.js";

function parseCorsOrigins() {
  const raw =
    process.env.SOCKET_CORS_ORIGIN ||
    process.env.CLIENT_ORIGIN ||
    "http://localhost:3000";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {import("http").Server} httpServer
 */
export function attachSocketServer(httpServer) {
  const origins = parseCorsOrigins();
  const io = new Server(httpServer, {
    path: "/socket.io",
    cors: {
      origin: origins.length ? origins : true,
      credentials: true,
    },
  });

  setSocketIo(io);

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token || !process.env.JWT_SECRET) {
        return next(new Error("unauthorized"));
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.tokenType === "admin") {
        return next(new Error("unauthorized"));
      }
      const userId = decoded.userId || decoded.id;
      if (!userId) return next(new Error("unauthorized"));

      const user = await UserModel.findById(userId).select("_id").lean();
      if (!user) return next(new Error("unauthorized"));

      socket.data.userId = String(user._id);

      const memberships = await OrganizationMembershipModel.find({
        userId: user._id,
      })
        .select("organizationId")
        .lean();

      for (const m of memberships) {
        socket.join(`org:${String(m.organizationId)}`);
      }

      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", () => {});

  return io;
}
