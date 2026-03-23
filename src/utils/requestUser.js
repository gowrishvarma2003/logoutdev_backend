function getAuthenticatedUserId(req) {
  return req?.user?.userId || req?.user?.id || null;
}

module.exports = {
  getAuthenticatedUserId,
};
