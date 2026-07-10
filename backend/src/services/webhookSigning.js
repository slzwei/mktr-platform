import crypto from 'crypto';

/** Only an explicit per-subscriber v2 opt-in changes the legacy wire format. */
export function signatureVersionForSubscriber(subscriber) {
  return subscriber?.metadata?.signatureVersion === 'v2' ? 'v2' : 'v1';
}

/** Build the HMAC header for one delivery attempt. */
export function signWebhookAttempt({ secret, rawBody, timestamp, signatureVersion }) {
  const signedContent = signatureVersion === 'v2' ? `${timestamp}.${rawBody}` : rawBody;
  const digest = crypto.createHmac('sha256', secret).update(signedContent).digest('hex');
  return `sha256=${digest}`;
}
