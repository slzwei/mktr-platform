/**
 * Review-pack lint (facebook-connect plan §4): the App Review pack must document
 * every permission the connect flow actually enforces — a scope added to the code
 * but missing from the pack would sail into an App Review rejection (or worse,
 * an approval that omits it). Pure file-content pin, no app boot.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serviceSrc = readFileSync(
  path.join(here, '../../src/services/metaConnectService.js'), 'utf8'
);
const pack = readFileSync(
  path.join(here, '../../../docs/reference/meta-app-review-pack.md'), 'utf8'
);

describe('meta app review pack', () => {
  const match = serviceSrc.match(/REQUIRED_SCOPES\s*=\s*\[([^\]]+)\]/);

  it('finds the enforced scope list in metaConnectService', () => {
    expect(match).toBeTruthy();
  });

  it('documents every enforced scope in the review pack', () => {
    const scopes = match[1].match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, ''));
    expect(scopes.length).toBeGreaterThanOrEqual(5);
    const missing = scopes.filter((s) => !pack.includes(`\`${s}\``));
    expect(missing).toEqual([]);
  });

  it('pins the login configuration id and the callback endpoints', () => {
    expect(pack).toContain('1082961057752303');
    expect(pack).toContain('/api/meta/oauth/callback');
    expect(pack).toContain('/api/meta/oauth/deauthorize');
    expect(pack).toContain('/api/meta/oauth/data-deletion');
  });
});
