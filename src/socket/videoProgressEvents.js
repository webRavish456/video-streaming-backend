/** Socket.io instance set from attachSocketServer; used by HTTP handlers & pipeline. */
let ioRef = null;

export function setSocketIo(io) {
  ioRef = io;
}

/**
 * Notify all socket clients in an organization room (members only, joined on connect).
 * @param {string} organizationId
 * @param {Record<string, unknown>} payload
 */
export function emitOrgVideoProgress(organizationId, payload) {
  if (!ioRef || organizationId == null) return;
  const id = String(organizationId);
  ioRef.to(`org:${id}`).emit("video:progress", {
    ...payload,
    organizationId: id,
  });
}
