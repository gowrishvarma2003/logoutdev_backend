const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const optionalAuthMiddleware = require('../../middleware/optionalAuthMiddleware');
const {
  profileUpdateRateLimiter,
  profileSkillsRateLimiter,
  profileFeaturedProjectsRateLimiter,
} = require('../../middleware/profilesRateLimiter');
const {
  getProfile,
  getProfileProjects,
  getProfilePosts,
  getProfileActivity,
  getProfileSignals,
  patchMyProfile,
  replaceMySkills,
  replaceMyFeaturedProjects,
} = require('../../controllers/profiles/profileController');

const router = express.Router();

// Public profile reads (with optional auth context)
router.use(optionalAuthMiddleware);
router.get('/:username', getProfile);
router.get('/:username/projects', getProfileProjects);
router.get('/:username/posts', getProfilePosts);
router.get('/:username/activity', getProfileActivity);
router.get('/:username/signals', getProfileSignals);

// Owner updates
router.use(authMiddleware);
router.patch('/me', profileUpdateRateLimiter, patchMyProfile);
router.put('/me/skills', profileSkillsRateLimiter, replaceMySkills);
router.put('/me/featured-projects', profileFeaturedProjectsRateLimiter, replaceMyFeaturedProjects);

module.exports = router;
