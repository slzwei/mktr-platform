import { AiSettings } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { decryptApiKey, encryptApiKey, isAiCredentialEncryptionReady } from '../utils/aiCredentialEncryption.js';

const SETTINGS_ID = 'global';
const DEFAULTS = {
  id: SETTINGS_ID,
  defaultProvider: 'openai',
  openaiModel: 'gpt-5.6-terra',
  anthropicModel: 'claude-sonnet-4-6',
  globalGuardrails: '',
  workstylePreferences: '',
};

async function getOrCreateSettings() {
  const [settings] = await AiSettings.findOrCreate({ where: { id: SETTINGS_ID }, defaults: DEFAULTS });
  return settings;
}

function providerStatus(settings, provider) {
  const isOpenAi = provider === 'openai';
  const encrypted = isOpenAi ? settings.openaiKeyEncrypted : settings.anthropicKeyEncrypted;
  const environmentValue = isOpenAi ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  const hint = isOpenAi ? settings.openaiKeyHint : settings.anthropicKeyHint;
  return {
    configured: Boolean(encrypted || environmentValue),
    source: encrypted ? 'admin' : environmentValue ? 'environment' : null,
    hint: encrypted ? hint : environmentValue ? 'server environment' : null,
  };
}

export async function getAdminAiSettings() {
  const settings = await getOrCreateSettings();
  return {
    defaultProvider: settings.defaultProvider,
    openaiModel: settings.openaiModel,
    anthropicModel: settings.anthropicModel,
    globalGuardrails: settings.globalGuardrails,
    workstylePreferences: settings.workstylePreferences,
    encryptionReady: isAiCredentialEncryptionReady(),
    providers: {
      openai: providerStatus(settings, 'openai'),
      anthropic: providerStatus(settings, 'anthropic'),
    },
    updatedAt: settings.updatedAt,
  };
}

export async function updateAdminAiSettings(input, userId) {
  const settings = await getOrCreateSettings();
  const changes = {
    defaultProvider: input.defaultProvider,
    openaiModel: input.openaiModel,
    anthropicModel: input.anthropicModel,
    globalGuardrails: input.globalGuardrails,
    workstylePreferences: input.workstylePreferences,
    updatedBy: userId,
  };

  if (input.openaiApiKey) {
    const value = input.openaiApiKey.trim();
    changes.openaiKeyEncrypted = encryptApiKey(value);
    changes.openaiKeyHint = `••••${value.slice(-4)}`;
  } else if (input.clearOpenaiKey) {
    changes.openaiKeyEncrypted = null;
    changes.openaiKeyHint = null;
  }
  if (input.anthropicApiKey) {
    const value = input.anthropicApiKey.trim();
    changes.anthropicKeyEncrypted = encryptApiKey(value);
    changes.anthropicKeyHint = `••••${value.slice(-4)}`;
  } else if (input.clearAnthropicKey) {
    changes.anthropicKeyEncrypted = null;
    changes.anthropicKeyHint = null;
  }

  await settings.update(changes);
  return getAdminAiSettings();
}

export async function getRuntimeAiSettings(requestedProvider) {
  const settings = await getOrCreateSettings();
  const provider = requestedProvider || settings.defaultProvider;
  if (!['openai', 'anthropic'].includes(provider)) throw new AppError('Unsupported AI provider.', 400);
  const isOpenAi = provider === 'openai';
  const encrypted = isOpenAi ? settings.openaiKeyEncrypted : settings.anthropicKeyEncrypted;
  const apiKey = encrypted
    ? decryptApiKey(encrypted)
    : isOpenAi ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AppError(`${isOpenAi ? 'OpenAI' : 'Claude'} is not configured. Add a credential in AI Settings.`, 409);
  return {
    provider,
    apiKey,
    model: isOpenAi ? settings.openaiModel : settings.anthropicModel,
    globalGuardrails: settings.globalGuardrails || '',
    workstylePreferences: settings.workstylePreferences || '',
  };
}
