import { createInstagramGraphClient } from '../src/integrations/instagram.js';

const expectedUsername = (process.env.META_INSTAGRAM_EXPECTED_USERNAME || 'belstekloexpert').trim().toLowerCase();

try {
  const identity = await createInstagramGraphClient(process.env.META_INSTAGRAM_ACCESS_TOKEN).getIdentity();
  console.log(JSON.stringify({
    ok: true,
    expected_username_match: identity.username.toLowerCase() === expectedUsername,
    account_id_present: Boolean(identity.id),
    username_present: Boolean(identity.username),
  }));
} catch (error) {
  const message = error instanceof Error ? error.message : 'Instagram token check failed.';
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exitCode = 1;
}
