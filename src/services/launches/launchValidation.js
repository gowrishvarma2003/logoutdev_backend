const {
  asTrimmedString,
  normalizeStringArray,
  normalizeHttpLinks,
  slugify,
  isAllowedValue,
} = require('../spaces/spaceValidation');

const LAUNCH_PRODUCT_TYPES = new Set([
  'web-app',
  'mobile-app',
  'developer-tool',
  'api',
  'ai-tool',
  'open-source',
  'experimental',
  'other',
]);
const LAUNCH_DEVELOPMENT_STAGES = new Set([
  'prototype',
  'mvp',
  'beta',
  'live',
  'maintained',
  'paused',
]);
const LAUNCH_COLLABORATION_MODES = new Set(['off', 'looking']);
const LAUNCH_STATUSES = new Set(['draft', 'published', 'archived']);
const LAUNCH_REVIEW_RECOMMENDATIONS = new Set(['recommend', 'mixed', 'not_recommend']);
const LAUNCH_FEEDBACK_TYPES = new Set(['suggestion', 'bug', 'idea']);
const LAUNCH_FEEDBACK_STATUSES = new Set(['open', 'acknowledged', 'planned', 'resolved', 'closed']);

function normalizeOptionalUrl(value) {
  const url = asTrimmedString(value) || null;
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : '';
}

function normalizeHttpsUrl(value) {
  const url = asTrimmedString(value) || null;
  if (!url) return null;
  return /^https:\/\//i.test(url) ? url : '';
}

function normalizeScreenshotList(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === 'string') {
        return {
          image_url: normalizeHttpsUrl(item),
          caption: null,
        };
      }

      return {
        image_url: normalizeHttpsUrl(item?.image_url),
        caption: asTrimmedString(item?.caption) || null,
      };
    })
    .filter((item) => item.image_url);
}

function buildLaunchSlug(seed) {
  return slugify(seed).slice(0, 140);
}

function validateLaunchInput(body, { partial = false } = {}) {
  const data = {};

  if (!partial || body.name !== undefined) {
    const name = asTrimmedString(body.name);
    if (name.length < 3 || name.length > 120) {
      return { error: 'name must be between 3 and 120 characters.' };
    }
    data.name = name;
  }

  if (!partial || body.tagline !== undefined) {
    const tagline = asTrimmedString(body.tagline);
    if (tagline.length < 20 || tagline.length > 180) {
      return { error: 'tagline must be between 20 and 180 characters.' };
    }
    data.tagline = tagline;
  }

  if (!partial || body.description !== undefined) {
    const description = asTrimmedString(body.description);
    if (description.length < 1 || description.length > 5000) {
      return { error: 'description must be between 1 and 5000 characters.' };
    }
    data.description = description;
  }

  if (!partial || body.product_type !== undefined) {
    const productType = asTrimmedString(body.product_type);
    if (!isAllowedValue(productType, LAUNCH_PRODUCT_TYPES)) {
      return { error: 'product_type is invalid.' };
    }
    data.product_type = productType;
  }

  if (!partial || body.development_stage !== undefined) {
    const developmentStage = asTrimmedString(body.development_stage);
    if (!isAllowedValue(developmentStage, LAUNCH_DEVELOPMENT_STAGES)) {
      return { error: 'development_stage is invalid.' };
    }
    data.development_stage = developmentStage;
  }

  if (!partial || body.demo_url !== undefined) {
    const demoUrl = normalizeOptionalUrl(body.demo_url);
    if (body.demo_url !== undefined && demoUrl === '') {
      return { error: 'demo_url must be an http/https URL.' };
    }
    data.demo_url = demoUrl;
  }

  if (!partial || body.website_url !== undefined) {
    const websiteUrl = normalizeOptionalUrl(body.website_url);
    if (body.website_url !== undefined && websiteUrl === '') {
      return { error: 'website_url must be an http/https URL.' };
    }
    data.website_url = websiteUrl;
  }

  if (!partial || body.github_url !== undefined) {
    const githubUrl = normalizeOptionalUrl(body.github_url);
    if (body.github_url !== undefined && githubUrl === '') {
      return { error: 'github_url must be an http/https URL.' };
    }
    data.github_url = githubUrl;
  }

  if (!partial || body.docs_url !== undefined) {
    const docsUrl = normalizeOptionalUrl(body.docs_url);
    if (body.docs_url !== undefined && docsUrl === '') {
      return { error: 'docs_url must be an http/https URL.' };
    }
    data.docs_url = docsUrl;
  }

  if (!partial || body.collaboration_mode !== undefined) {
    const collaborationMode = asTrimmedString(body.collaboration_mode || 'off');
    if (!isAllowedValue(collaborationMode, LAUNCH_COLLABORATION_MODES)) {
      return { error: 'collaboration_mode must be off or looking.' };
    }
    data.collaboration_mode = collaborationMode;
  }

  if (!partial || body.collaboration_note !== undefined) {
    const collaborationNote = asTrimmedString(body.collaboration_note) || null;
    if (collaborationNote && collaborationNote.length > 1000) {
      return { error: 'collaboration_note must be 1000 characters or fewer.' };
    }
    data.collaboration_note = collaborationNote;
  }

  if (!partial || body.collaboration_roles !== undefined) {
    const collaborationRoles = normalizeStringArray(body.collaboration_roles, 8);
    data.collaboration_roles = collaborationRoles;
  }

  if (!partial || body.linked_space_id !== undefined) {
    const linkedSpaceId = asTrimmedString(body.linked_space_id) || null;
    data.linked_space_id = linkedSpaceId;
  }

  if (!partial || body.slug !== undefined) {
    const slugSeed = body.slug !== undefined ? body.slug : body.name;
    const slug = buildLaunchSlug(slugSeed);
    if (!slug) {
      return { error: 'Unable to generate a valid slug.' };
    }
    data.slug = slug;
  }

  if (!partial || body.screenshots !== undefined) {
    const screenshots = normalizeScreenshotList(body.screenshots);
    if (Array.isArray(body.screenshots) && screenshots.length !== body.screenshots.filter(Boolean).length) {
      return { error: 'screenshots must use external HTTPS URLs only.' };
    }
    if (screenshots.length > 6) {
      return { error: 'screenshots can contain at most 6 items.' };
    }
    data.screenshots = screenshots;
  }

  if (!partial || body.tech_stack !== undefined) {
    const techStack = normalizeStringArray(body.tech_stack, 12);
    data.tech_stack = techStack;
  }

  return { data };
}

function validateLaunchForPublish(launch) {
  if (!launch.name || launch.name.length < 3) return 'name is required before publishing.';
  if (!launch.tagline || launch.tagline.length < 20) return 'tagline is required before publishing.';
  if (!launch.description || !launch.description.trim()) return 'description is required before publishing.';
  if (!launch.product_type) return 'product_type is required before publishing.';
  if (!launch.development_stage) return 'development_stage is required before publishing.';

  if (!launch.demo_url && !launch.website_url && !launch.github_url) {
    return 'At least one of demo_url, website_url, or github_url is required before publishing.';
  }

  if (!Array.isArray(launch.screenshots) || launch.screenshots.length < 1) {
    return 'At least one screenshot is required before publishing.';
  }

  return null;
}

function validateLaunchReviewInput(body) {
  const headline = asTrimmedString(body.headline);
  const bodyText = asTrimmedString(body.body);
  const recommendation = asTrimmedString(body.recommendation);

  if (headline.length < 3 || headline.length > 120) {
    return { error: 'headline must be between 3 and 120 characters.' };
  }
  if (bodyText.length < 20 || bodyText.length > 2000) {
    return { error: 'body must be between 20 and 2000 characters.' };
  }
  if (!isAllowedValue(recommendation, LAUNCH_REVIEW_RECOMMENDATIONS)) {
    return { error: 'recommendation is invalid.' };
  }

  return {
    data: {
      headline,
      body: bodyText,
      recommendation,
    },
  };
}

function validateFeedbackInput(body, { partial = false } = {}) {
  const data = {};

  if (!partial || body.type !== undefined) {
    const type = asTrimmedString(body.type);
    if (!isAllowedValue(type, LAUNCH_FEEDBACK_TYPES)) {
      return { error: 'type must be suggestion, bug, or idea.' };
    }
    data.type = type;
  }

  if (!partial || body.title !== undefined) {
    const title = asTrimmedString(body.title);
    if (title.length < 3 || title.length > 140) {
      return { error: 'title must be between 3 and 140 characters.' };
    }
    data.title = title;
  }

  if (!partial || body.body !== undefined) {
    const bodyText = asTrimmedString(body.body);
    if (bodyText.length < 10 || bodyText.length > 3000) {
      return { error: 'body must be between 10 and 3000 characters.' };
    }
    data.body = bodyText;
  }

  if (!partial || body.status !== undefined) {
    const status = asTrimmedString(body.status);
    if (!isAllowedValue(status, LAUNCH_FEEDBACK_STATUSES)) {
      return { error: 'status is invalid.' };
    }
    data.status = status;
  }

  return { data };
}

function validateFeedbackCommentInput(body) {
  const commentBody = asTrimmedString(body.body);
  if (commentBody.length < 3 || commentBody.length > 1500) {
    return { error: 'Comment body must be between 3 and 1500 characters.' };
  }

  return { data: { body: commentBody } };
}

function validateCollaborationRequestInput(body) {
  const message = asTrimmedString(body.message);
  const rawAvailability = body.availability_hours;
  const availabilityHours = rawAvailability != null && rawAvailability !== '' ? Number(rawAvailability) : null;
  const skills = normalizeStringArray(body.skills, 25);
  const proofLinks = normalizeHttpLinks(body.proof_links, 10);

  if (message.length < 10 || message.length > 2000) {
    return { error: 'message must be between 10 and 2000 characters.' };
  }

  if (availabilityHours !== null && (!Number.isFinite(availabilityHours) || availabilityHours < 1 || availabilityHours > 80)) {
    return { error: 'availability_hours must be a number between 1 and 80.' };
  }

  return {
    data: {
      message,
      skills,
      availability_hours: availabilityHours,
      proof_links: proofLinks,
    },
  };
}

module.exports = {
  LAUNCH_PRODUCT_TYPES,
  LAUNCH_DEVELOPMENT_STAGES,
  LAUNCH_COLLABORATION_MODES,
  LAUNCH_STATUSES,
  LAUNCH_REVIEW_RECOMMENDATIONS,
  LAUNCH_FEEDBACK_TYPES,
  LAUNCH_FEEDBACK_STATUSES,
  buildLaunchSlug,
  validateLaunchInput,
  validateLaunchForPublish,
  validateLaunchReviewInput,
  validateFeedbackInput,
  validateFeedbackCommentInput,
  validateCollaborationRequestInput,
};