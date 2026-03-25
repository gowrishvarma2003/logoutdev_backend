function buildBetaSummary({ capacity = null, approvedCount = 0, pendingCount = 0 }) {
  const safeCapacity = Number.isInteger(capacity) && capacity > 0 ? capacity : null;
  const remainingSeats = safeCapacity === null ? null : Math.max(safeCapacity - approvedCount, 0);

  return {
    capacity: safeCapacity,
    approved_count: approvedCount,
    pending_count: pendingCount,
    remaining_seats: remainingSeats,
    is_full: safeCapacity !== null ? approvedCount >= safeCapacity : false,
  };
}

function canViewFeedbackItem({
  item,
  launchPhase,
  viewerId = null,
  isOwner = false,
  isApprovedBetaUser = false,
}) {
  if (!item) return false;
  if (item.visibility_scope !== 'beta') return true;
  if (isOwner) return true;
  if (!viewerId) return false;

  if (launchPhase === 'beta') {
    return isApprovedBetaUser || item.author_id === viewerId || (item.comments || []).some((comment) => comment.author_id === viewerId);
  }

  return item.author_id === viewerId || (item.comments || []).some((comment) => comment.author_id === viewerId);
}

function canCreateFeedback({ launchPhase, isOwner = false, isApprovedBetaUser = false }) {
  if (isOwner) return false;
  if (launchPhase === 'beta') return isApprovedBetaUser;
  return true;
}

module.exports = {
  buildBetaSummary,
  canViewFeedbackItem,
  canCreateFeedback,
};
