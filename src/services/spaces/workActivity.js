const { ProjectSpaceIssueActivity } = require('../../models');

async function logWorkActivity({
  spaceId,
  issueId,
  actorUserId = null,
  eventType,
  payload = {},
  createdAt = new Date(),
}) {
  if (!spaceId || !issueId || !eventType) return null;

  return ProjectSpaceIssueActivity.create({
    space_id: spaceId,
    issue_id: issueId,
    actor_user_id: actorUserId,
    event_type: eventType,
    payload,
    created_at: createdAt,
  });
}

module.exports = {
  logWorkActivity,
};
