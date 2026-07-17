import { asyncHandler } from '../middleware/errorHandler.js';
import { getAdminAiSettings, updateAdminAiSettings } from '../services/aiSettingsService.js';
import { generateGuidedReviewDraft, testAiProvider } from '../services/guidedReviewAiService.js';
import { generateCampaignCopyDraft } from '../services/campaignCopyAiService.js';

export const getSettings = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { settings: await getAdminAiSettings() } });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const settings = await updateAdminAiSettings(req.body, req.user.id);
  res.json({ success: true, message: 'AI settings saved.', data: { settings } });
});

export const generateGuidedReview = asyncHandler(async (req, res) => {
  const draft = await generateGuidedReviewDraft(req.body, req.user.id);
  res.json({ success: true, data: { draft } });
});

export const testProvider = asyncHandler(async (req, res) => {
  const result = await testAiProvider(req.params.provider, req.user.id);
  res.json({ success: true, data: result });
});

// Campaign Studio copy assist (Studio PR 4): data = {draft} (mode copy) or
// {proposals} (mode full).
export const generateCampaignCopy = asyncHandler(async (req, res) => {
  const result = await generateCampaignCopyDraft(req.body, req.user.id);
  res.json({ success: true, data: result });
});
