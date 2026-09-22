import { createInstagramGraphClient } from '../src/integrations/instagram.js';

const expectedUsername = (process.env.META_INSTAGRAM_EXPECTED_USERNAME || 'belstekloexpert').trim().toLowerCase();

try {
  const identity = await createInstagramGraphClient(process.env.META_INSTAGRAM_ACCESS_TOKEN).getIdentity();
  const usernameMatch = identity.username.toLowerCase() === expectedUsername;
  const configuredId = process.env.META_INSTAGRAM_ACCOUNT_ID?.trim();
  const accountMatch = configuredId ? configuredId === identity.userId : null;
  const allowed = (process.env.META_ALLOWED_RECIPIENT_IDS || '').split(',').map((id) => id.trim());
  console.log(JSON.stringify({
    ok: usernameMatch && accountMatch !== false,
    expected_username_match: usernameMatch,
    account_id_present: Boolean(identity.id),
    instagram_user_id_present: Boolean(identity.userId),
    configured_account_id_match: accountMatch,
    webhook_allowlist_contains_user_id: Boolean(identity.userId && allowed.includes(identity.userId)),
    messaging_permissions_verified: false,
    username_present: Boolean(identity.username),
  }));
  if (!usernameMatch || accountMatch === false) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ ok: false, error: 'Instagram identity check failed. No token or provider response logged.' }));
  process.exitCode = 1;
}
