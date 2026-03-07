const {
  asTrimmedString,
  normalizeStringArray,
  normalizeHttpLinks,
  slugify,
  isAllowedValue,
} = require('../spaces/spaceValidation');

const FREELANCE_PRICING_MODELS = new Set(['fixed', 'hourly']);
const FREELANCE_EXPERIENCE_LEVELS = new Set(['any', 'junior', 'mid', 'senior']);
const FREELANCE_ENGAGEMENT_TYPES = new Set(['one_time', 'ongoing']);
const FREELANCE_LOCATION_MODES = new Set(['remote', 'hybrid', 'onsite']);
const FREELANCE_PROJECT_STATUSES = new Set(['open', 'in_review', 'awarded', 'completed', 'cancelled']);
const FREELANCE_PROPOSAL_STATUSES = new Set(['submitted', 'shortlisted', 'accepted', 'rejected', 'withdrawn']);
const FREELANCE_PROPOSAL_REVIEW_ACTIONS = new Set(['shortlist', 'reject', 'accept']);

function normalizeCurrencyCode(value) {
  const code = asTrimmedString(value || 'USD').toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : '';
}

function normalizeInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function validateProjectInput(body, { partial = false } = {}) {
  const data = {};

  if (!partial || body.title !== undefined) {
    const title = asTrimmedString(body.title);
    if (title.length < 5 || title.length > 120) {
      return { error: 'Project title must be between 5 and 120 characters.' };
    }
    data.title = title;
  }

  if (!partial || body.summary !== undefined) {
    const summary = asTrimmedString(body.summary);
    if (summary.length < 20 || summary.length > 240) {
      return { error: 'Project summary must be between 20 and 240 characters.' };
    }
    data.summary = summary;
  }

  if (!partial || body.description !== undefined) {
    const description = asTrimmedString(body.description);
    if (description.length < 50 || description.length > 5000) {
      return { error: 'Project description must be between 50 and 5000 characters.' };
    }
    data.description = description;
  }

  if (!partial || body.pricing_model !== undefined) {
    const pricingModel = asTrimmedString(body.pricing_model);
    if (!isAllowedValue(pricingModel, FREELANCE_PRICING_MODELS)) {
      return { error: 'pricing_model must be fixed or hourly.' };
    }
    data.pricing_model = pricingModel;
  }

  if (!partial || body.currency_code !== undefined) {
    const currencyCode = normalizeCurrencyCode(body.currency_code);
    if (!currencyCode) {
      return { error: 'currency_code must be a 3-letter ISO code.' };
    }
    data.currency_code = currencyCode;
  }

  const wantsBudgetValidation = !partial || body.budget_min_cents !== undefined || body.budget_max_cents !== undefined;
  const budgetMin = wantsBudgetValidation ? normalizeInteger(body.budget_min_cents) : undefined;
  const budgetMax = wantsBudgetValidation ? normalizeInteger(body.budget_max_cents) : undefined;

  if (budgetMin !== undefined) {
    if (budgetMin === null || budgetMin < 0) {
      return { error: 'budget_min_cents must be zero or greater.' };
    }
    data.budget_min_cents = budgetMin;
  }

  if (budgetMax !== undefined) {
    if (budgetMax === null || budgetMax < 0) {
      return { error: 'budget_max_cents must be zero or greater.' };
    }
    data.budget_max_cents = budgetMax;
  }

  if (wantsBudgetValidation) {
    if (budgetMin === null || budgetMax === null || budgetMin === undefined || budgetMax === undefined) {
      return { error: 'budget_min_cents and budget_max_cents are required.' };
    }
    if (budgetMax < budgetMin) {
      return { error: 'budget_max_cents must be greater than or equal to budget_min_cents.' };
    }
  }

  if (!partial || body.experience_level !== undefined) {
    const experienceLevel = asTrimmedString(body.experience_level || 'any');
    if (!isAllowedValue(experienceLevel, FREELANCE_EXPERIENCE_LEVELS)) {
      return { error: 'experience_level must be any, junior, mid, or senior.' };
    }
    data.experience_level = experienceLevel;
  }

  if (!partial || body.engagement_type !== undefined) {
    const engagementType = asTrimmedString(body.engagement_type);
    if (!isAllowedValue(engagementType, FREELANCE_ENGAGEMENT_TYPES)) {
      return { error: 'engagement_type must be one_time or ongoing.' };
    }
    data.engagement_type = engagementType;
  }

  if (!partial || body.duration_weeks !== undefined) {
    const durationWeeks = normalizeInteger(body.duration_weeks);
    if (durationWeeks !== null && (durationWeeks < 1 || durationWeeks > 52)) {
      return { error: 'duration_weeks must be between 1 and 52.' };
    }
    data.duration_weeks = durationWeeks;
  }

  if (!partial || body.location_mode !== undefined) {
    const locationMode = asTrimmedString(body.location_mode || 'remote');
    if (!isAllowedValue(locationMode, FREELANCE_LOCATION_MODES)) {
      return { error: 'location_mode must be remote, hybrid, or onsite.' };
    }
    data.location_mode = locationMode;
  }

  if (!partial || body.timezone_note !== undefined) {
    const timezoneNote = asTrimmedString(body.timezone_note) || null;
    if (timezoneNote && timezoneNote.length > 120) {
      return { error: 'timezone_note must be 120 characters or fewer.' };
    }
    data.timezone_note = timezoneNote;
  }

  if (!partial || body.skills !== undefined) {
    const skills = normalizeStringArray(body.skills, 8);
    if (skills.length < 1 || skills.length > 8) {
      return { error: 'skills must contain between 1 and 8 items.' };
    }
    data.skills = skills;
  }

  return { data };
}

function validateProposalInput(body, { partial = false } = {}) {
  const data = {};

  if (!partial || body.cover_note !== undefined) {
    const coverNote = asTrimmedString(body.cover_note);
    if (coverNote.length < 50 || coverNote.length > 2000) {
      return { error: 'cover_note must be between 50 and 2000 characters.' };
    }
    data.cover_note = coverNote;
  }

  if (!partial || body.pricing_model !== undefined) {
    const pricingModel = asTrimmedString(body.pricing_model);
    if (!isAllowedValue(pricingModel, FREELANCE_PRICING_MODELS)) {
      return { error: 'pricing_model must be fixed or hourly.' };
    }
    data.pricing_model = pricingModel;
  }

  if (!partial || body.currency_code !== undefined) {
    const currencyCode = normalizeCurrencyCode(body.currency_code);
    if (!currencyCode) {
      return { error: 'currency_code must be a 3-letter ISO code.' };
    }
    data.currency_code = currencyCode;
  }

  if (!partial || body.bid_amount_cents !== undefined) {
    const bidAmount = normalizeInteger(body.bid_amount_cents);
    if (bidAmount === null || bidAmount < 1) {
      return { error: 'bid_amount_cents must be greater than zero.' };
    }
    data.bid_amount_cents = bidAmount;
  }

  if (!partial || body.estimated_duration_weeks !== undefined) {
    const durationWeeks = normalizeInteger(body.estimated_duration_weeks);
    if (durationWeeks !== null && (durationWeeks < 1 || durationWeeks > 52)) {
      return { error: 'estimated_duration_weeks must be between 1 and 52.' };
    }
    data.estimated_duration_weeks = durationWeeks;
  }

  if (!partial || body.availability_hours !== undefined) {
    const availabilityHours = normalizeInteger(body.availability_hours);
    if (availabilityHours !== null && (availabilityHours < 1 || availabilityHours > 80)) {
      return { error: 'availability_hours must be between 1 and 80.' };
    }
    data.availability_hours = availabilityHours;
  }

  if (!partial || body.proof_links !== undefined) {
    data.proof_links = normalizeHttpLinks(body.proof_links, 5);
  }

  return { data };
}

function canAcceptNewProposals(status) {
  return status === 'open' || status === 'in_review';
}

function isEditableProjectStatus(status) {
  return status === 'open' || status === 'in_review';
}

function isEditableProposalStatus(status) {
  return status === 'submitted' || status === 'shortlisted';
}

function isProjectStatusTransitionAllowed(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) return true;
  if (currentStatus === 'open' && ['in_review', 'cancelled'].includes(nextStatus)) return true;
  if (currentStatus === 'in_review' && ['open', 'cancelled'].includes(nextStatus)) return true;
  if (currentStatus === 'awarded' && nextStatus === 'completed') return true;
  return false;
}

function buildFreelanceSlug(seed) {
  return slugify(seed).slice(0, 140);
}

module.exports = {
  FREELANCE_PRICING_MODELS,
  FREELANCE_EXPERIENCE_LEVELS,
  FREELANCE_ENGAGEMENT_TYPES,
  FREELANCE_LOCATION_MODES,
  FREELANCE_PROJECT_STATUSES,
  FREELANCE_PROPOSAL_STATUSES,
  FREELANCE_PROPOSAL_REVIEW_ACTIONS,
  validateProjectInput,
  validateProposalInput,
  canAcceptNewProposals,
  isEditableProjectStatus,
  isEditableProposalStatus,
  isProjectStatusTransitionAllowed,
  buildFreelanceSlug,
};
