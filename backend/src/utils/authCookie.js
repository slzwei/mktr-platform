const COOKIE_NAME = 'mktr_token';

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (matches JWT_EXPIRES_IN default)
};

export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, cookieOptions);
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/', httpOnly: true, secure: cookieOptions.secure, sameSite: cookieOptions.sameSite });
}

export { COOKIE_NAME };
