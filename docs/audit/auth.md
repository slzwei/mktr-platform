# auth jwks & token issuance

## env matrix

- AUTH_PRIVATE_KEY_PEM: PKCS#8 RSA private key (PEM, single line with \n escaped in env stores)
- AUTH_JWKS_KID: current key id (kid). if omitted, derived from thumbprint
- AUTH_JWT_ISSUER: token issuer (iss). fallback: AUTH_ISSUER
- AUTH_JWT_AUDIENCE: token audience (aud). fallback: AUTH_AUDIENCE
- AUTH_PREVIOUS_PUBLIC_KEY_PEM: optional previous public key (PEM) to serve in JWKS for rotation grace
- AUTH_PREVIOUS_KID: optional previous kid; if omitted, derived from thumbprint

## rotation runbook (dual kid window)

1. generate new RSA keypair (PKCS#8). store private key as AUTH_PRIVATE_KEY_PEM. set AUTH_JWKS_KID=new-kid
2. move existing public key PEM into AUTH_PREVIOUS_PUBLIC_KEY_PEM and AUTH_PREVIOUS_KID=old-kid
3. deploy auth-service. JWKS now advertises [new-kid, old-kid]
4. wait for consumers’ JWKS caches (gateway) to refresh (<=60s). monitor gateway logs for kids list
5. rotate consumers if any pinning exists (none by default)
6. remove AUTH_PREVIOUS_PUBLIC_KEY_PEM/AUTH_PREVIOUS_KID after grace window

## cache ttl guidance

- gateway uses jose RemoteJWKSet with cooldown ~60s. do not set aggressive CDN caching in front of JWKS
- auth JWKS responds with Cache-Control: max-age=60

## token claims

- header: alg=RS256, kid=<current>
- payload: iss, aud, iat, exp, sub, tid, roles, email
- default exp: 15m (tests)

## references

- services/auth-service/src/server.js: key import, JWKS, SignJWT
- services/gateway/src/server.js: RemoteJWKSet, jwtVerify, boot log of issuer/kids
- .github/workflows/smoke-phase-b.yml: JWKS probe, login via AUTH_URL, negative unknown-kid check
