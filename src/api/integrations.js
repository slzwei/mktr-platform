// REPLACED: Base44 integrations with our custom API client
import { integrations } from './client.js';

export const Core = integrations.Core;

export const InvokeLLM = integrations.Core.InvokeLLM;

export const SendEmail = integrations.Core.SendEmail;

export const UploadFile = integrations.Core.UploadFile;

export const GenerateImage = integrations.Core.GenerateImage;

export const ExtractDataFromUploadedFile = integrations.Core.ExtractDataFromUploadedFile;






