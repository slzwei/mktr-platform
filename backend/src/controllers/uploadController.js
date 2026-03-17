import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import * as uploadService from '../services/uploadService.js';

// --- Single file upload ---
export const uploadSingle = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }

  const { type = 'general' } = req.query;
  const fileInfo = await uploadService.processSingleUpload(req.file, type, req.user.id);

  res.json({
    success: true,
    message: 'File uploaded successfully',
    data: { file: fileInfo }
  });
});

// --- Multiple files upload ---
export const uploadMultiple = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No files uploaded', 400);
  }

  const { type = 'general' } = req.query;
  const files = await uploadService.processMultipleUpload(req.files, type, req.user.id);

  res.json({
    success: true,
    message: `${files.length} files uploaded successfully`,
    data: { files }
  });
});

// --- Avatar upload ---
export const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No avatar file uploaded', 400);
  }

  const avatar = await uploadService.processAvatarUpload(req.file, req.user);

  res.json({
    success: true,
    message: 'Avatar uploaded successfully',
    data: { avatar }
  });
});

// --- Campaign assets upload ---
export const uploadCampaignAssets = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No campaign assets uploaded', 400);
  }

  const { campaignId } = req.body;
  if (!campaignId) {
    throw new AppError('Campaign ID is required', 400);
  }

  const assets = await uploadService.processCampaignAssets(req.files, campaignId, req.user.id);

  res.json({
    success: true,
    message: `${assets.length} campaign assets uploaded successfully`,
    data: { assets }
  });
});

// --- Document upload ---
export const uploadDocuments = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No documents uploaded', 400);
  }

  const { entityType, entityId } = req.body;
  if (!entityType || !entityId) {
    throw new AppError('Entity type and ID are required', 400);
  }

  const documents = await uploadService.processDocumentUpload(req.files, entityType, entityId, req.user.id);

  res.json({
    success: true,
    message: `${documents.length} documents uploaded successfully`,
    data: { documents }
  });
});

// --- Delete file ---
export const deleteFile = asyncHandler(async (req, res) => {
  const { type, filename } = req.params;
  uploadService.deleteFile(type, filename);

  res.json({
    success: true,
    message: 'File deleted successfully'
  });
});

// --- Get file info ---
export const getFileInfo = asyncHandler(async (req, res) => {
  const { type, filename } = req.params;
  const fileInfo = uploadService.getFileInfo(type, filename);

  res.json({
    success: true,
    data: { file: fileInfo }
  });
});

// --- List files ---
export const listFiles = asyncHandler(async (req, res) => {
  const { type } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const result = uploadService.listFiles(type, page, limit);

  res.json({
    success: true,
    data: result
  });
});

// --- Storage usage stats ---
export const getStorageUsage = asyncHandler(async (req, res) => {
  const result = uploadService.getStorageUsage();

  res.json({
    success: true,
    data: result
  });
});
