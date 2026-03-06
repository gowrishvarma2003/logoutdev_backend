function parsePagination(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const limitRaw = Number(query.limit);
  const pageRaw = Number(query.page);

  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), maxLimit)
    : defaultLimit;

  const page = Number.isFinite(pageRaw)
    ? Math.max(Math.trunc(pageRaw), 1)
    : 1;

  const offset = (page - 1) * limit;

  return { limit, page, offset };
}

module.exports = { parsePagination };
