export function buildAuthInfo(authSession) {
  if (!authSession) return null;
  const info = { role: 'owner' };
  if (typeof authSession.preferredLanguage === 'string' && authSession.preferredLanguage.trim()) {
    info.preferredLanguage = authSession.preferredLanguage.trim();
  }
  return info;
}
