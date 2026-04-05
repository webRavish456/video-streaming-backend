import express from "express";
import { registerUser, loginUser } from "../controllers/userControllers.js";
import {
  uploadVideoMiddleware,
  requireCloudinaryForOrgUpload,
} from "../middleware/videoUpload.js";
import {
  listPublicVideos,
  getPublicVideoMeta,
  handleUploadError,
  streamVideo,
  streamVideoOptions,
} from "../controllers/videoControllers.js";
import {
  verifyAppUserToken,
  loadOrgMembershipParam,
  requireOrgRoles,
} from "../middleware/verifyAppUserToken.js";
import {
  listMyOrganizations,
  createMyOrganization,
  patchMyOrganization,
  deleteMyOrganization,
  listOrganizationMembers,
  addOrganizationMember,
  patchOrganizationMember,
  deleteOrganizationMember,
} from "../controllers/organizationControllers.js";
import {
  listOrgVideos,
  createOrgVideo,
  getOrgVideoStatus,
  getOrgMemberVideoWatchMeta,
  replaceOrgVideo,
  patchOrgVideo,
  deleteOrgVideo,
} from "../controllers/userOrgVideoControllers.js";

export const router = express.Router();

router.route("/users/register").post(registerUser);
router.route("/users/login").post(loginUser);

router
  .route("/users/me/organizations")
  .get(verifyAppUserToken, listMyOrganizations)
  .post(verifyAppUserToken, createMyOrganization);

router
  .route("/users/me/organizations/:organizationId")
  .patch(
    verifyAppUserToken,
    loadOrgMembershipParam,
    requireOrgRoles("admin"),
    patchMyOrganization
  )
  .delete(
    verifyAppUserToken,
    loadOrgMembershipParam,
    deleteMyOrganization
  );

router
  .route("/users/me/organizations/:organizationId/members")
  .get(verifyAppUserToken, loadOrgMembershipParam, listOrganizationMembers)
  .post(
    verifyAppUserToken,
    loadOrgMembershipParam,
    requireOrgRoles("admin"),
    addOrganizationMember
  );

router
  .route("/users/me/organizations/:organizationId/members/:memberUserId")
  .patch(
    verifyAppUserToken,
    loadOrgMembershipParam,
    requireOrgRoles("admin"),
    patchOrganizationMember
  )
  .delete(
    verifyAppUserToken,
    loadOrgMembershipParam,
    requireOrgRoles("admin"),
    deleteOrganizationMember
  );

router
  .route("/users/me/videos/:videoId/watch-meta")
  .get(verifyAppUserToken, getOrgMemberVideoWatchMeta);

router
  .route("/users/me/organizations/:organizationId/videos")
  .get(verifyAppUserToken, loadOrgMembershipParam, listOrgVideos)
  .post(
    verifyAppUserToken,
    loadOrgMembershipParam,
    requireOrgRoles("admin", "editor"),
    requireCloudinaryForOrgUpload,
    uploadVideoMiddleware,
    handleUploadError,
    createOrgVideo
  );

router
  .route("/users/me/organizations/:organizationId/videos/:videoId/status")
  .get(verifyAppUserToken, loadOrgMembershipParam, getOrgVideoStatus);

router
  .route("/users/me/organizations/:organizationId/videos/:videoId/replace")
  .post(
    verifyAppUserToken,
    loadOrgMembershipParam,
    requireOrgRoles("admin", "editor"),
    requireCloudinaryForOrgUpload,
    uploadVideoMiddleware,
    handleUploadError,
    replaceOrgVideo
  );

router
  .route("/users/me/organizations/:organizationId/videos/:videoId")
  .patch(
    verifyAppUserToken,
    loadOrgMembershipParam,
    requireOrgRoles("admin", "editor"),
    patchOrgVideo
  )
  .delete(
    verifyAppUserToken,
    loadOrgMembershipParam,
    requireOrgRoles("admin"),
    deleteOrgVideo
  );

router.route("/videos").get(listPublicVideos);

router
  .route("/videos/:id/stream")
  .options(streamVideoOptions)
  .get(streamVideo);

router.route("/videos/:id").get(getPublicVideoMeta);
