import crypto from 'crypto';
import { ProvisioningSession, Device } from '../models/index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Create a new provisioning session with a 1-hour expiry.
 * Returns { expiresAt } on success, or { alreadyExists: true } for duplicates.
 */
export async function createSession({ sessionCode, ipAddress }) {
  if (!sessionCode) {
    return { error: 'sessionCode (UUID) is required', status: 400 };
  }

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  try {
    await ProvisioningSession.create({
      sessionCode,
      ipAddress,
      status: 'pending',
      expiresAt
    });
    return { expiresAt };
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return { alreadyExists: true };
    }
    throw error;
  }
}

/**
 * Poll session status by code.
 * Returns { status, deviceKey? } or null if not found.
 */
export async function checkSession(code) {
  // sessionCode is a UUID column: a non-UUID code can't match any row and would
  // make Postgres throw "invalid input syntax for type uuid" (→ 500). Treat a
  // malformed code as simply not found.
  if (!code || !UUID_RE.test(code)) return null;

  const session = await ProvisioningSession.findOne({
    where: { sessionCode: code }
  });

  if (!session) return null;

  if (new Date() > session.expiresAt) {
    return { status: 'expired' };
  }

  if (session.status === 'fulfilled') {
    return { status: 'fulfilled', deviceKey: session.deviceKey };
  }

  return { status: 'pending' };
}

/**
 * Fulfill a provisioning session with a device key.
 * Returns { error, status } on failure, or { success: true } on success.
 */
export async function fulfillSession({ sessionCode, deviceKey }) {
  if (!sessionCode || !deviceKey) {
    return { error: 'sessionCode and deviceKey are required', status: 400 };
  }

  const session = await ProvisioningSession.findOne({
    where: { sessionCode }
  });

  if (!session) {
    return { error: 'Session not found', status: 404 };
  }

  if (new Date() > session.expiresAt) {
    return { error: 'Session expired', status: 400 };
  }

  if (session.status === 'fulfilled') {
    return { error: 'Session already fulfilled', status: 400 };
  }

  // Validate Key Exists
  const secretHash = crypto.createHash('sha256').update(deviceKey).digest('hex');
  const device = await Device.findOne({ where: { secretHash } });

  if (!device) {
    return { error: 'Invalid Device Key. Device must be registered first.', status: 400 };
  }

  await session.update({
    status: 'fulfilled',
    deviceKey
  });

  return { success: true };
}
