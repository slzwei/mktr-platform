import { decryptApiKey, encryptApiKey, isAiCredentialEncryptionReady } from '../utils/aiCredentialEncryption.js';

describe('AI credential encryption', () => {
  const originalSecret = process.env.AI_SETTINGS_ENCRYPTION_KEY;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.AI_SETTINGS_ENCRYPTION_KEY;
    else process.env.AI_SETTINGS_ENCRYPTION_KEY = originalSecret;
  });

  it('encrypts with authenticated encryption and decrypts the original value', () => {
    process.env.AI_SETTINGS_ENCRYPTION_KEY = 'test-only-master-secret-at-least-32-characters';
    const encrypted = encryptApiKey('sk-provider-secret');
    expect(encrypted).not.toContain('sk-provider-secret');
    expect(decryptApiKey(encrypted)).toBe('sk-provider-secret');
    expect(isAiCredentialEncryptionReady()).toBe(true);
  });

  it('refuses to store a credential without a sufficiently long master secret', () => {
    process.env.AI_SETTINGS_ENCRYPTION_KEY = 'too-short';
    expect(() => encryptApiKey('sk-provider-secret')).toThrow('encryption is not configured');
    expect(isAiCredentialEncryptionReady()).toBe(false);
  });

  it('detects ciphertext tampering', () => {
    process.env.AI_SETTINGS_ENCRYPTION_KEY = 'test-only-master-secret-at-least-32-characters';
    const encrypted = encryptApiKey('sk-provider-secret');
    const tampered = `${encrypted.slice(0, -2)}AA`;
    expect(() => decryptApiKey(tampered)).toThrow('cannot be decrypted');
  });
});
