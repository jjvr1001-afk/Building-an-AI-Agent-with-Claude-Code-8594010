import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ToolCallOptions } from '@ai-sdk/provider-utils';
import { listPreferences, addPreference, removePreference } from '../../src/memory/preferences.ts';

const PREFS_PATH = fileURLToPath(new URL('../../src/memory/preferences.md', import.meta.url));
const OPTS = { toolCallId: 'test', messages: [] } satisfies ToolCallOptions;

async function list(): Promise<string> {
  return (await listPreferences.execute!({}, OPTS)) as string;
}
async function add(text: string): Promise<unknown> {
  return await addPreference.execute!({ text }, OPTS);
}
async function remove(text: string): Promise<unknown> {
  return await removePreference.execute!({ text }, OPTS);
}

function bullets(contents: string): string[] {
  return contents.split('\n').filter((l) => l.startsWith('- '));
}

// No env dependencies — these tests never skip. They run against the real
// preferences.md; the original is stashed in memory and restored (or deleted
// if none existed) after every test.
let original: string | null;

beforeEach(() => {
  original = existsSync(PREFS_PATH) ? readFileSync(PREFS_PATH, 'utf8') : null;
  rmSync(PREFS_PATH, { force: true });
});

afterEach(() => {
  if (original === null) rmSync(PREFS_PATH, { force: true });
  else writeFileSync(PREFS_PATH, original);
});

describe('listPreferences', () => {
  it('returns "" when the file does not exist', async () => {
    expect(existsSync(PREFS_PATH)).toBe(false);
    expect(await list()).toBe('');
  });

  it('returns the file contents as a string', async () => {
    const contents = '# Preferences\n\n- Prefer subject lines under 50 characters.\n';
    writeFileSync(PREFS_PATH, contents);
    expect(await list()).toBe(contents);
  });
});

describe('addPreference', () => {
  it('creates the file with a "# Preferences" header on first write', async () => {
    await add('Always include hiring trajectory.');
    expect(existsSync(PREFS_PATH)).toBe(true);
    expect(readFileSync(PREFS_PATH, 'utf8').startsWith('# Preferences')).toBe(true);
  });

  it('round-trips through listPreferences as a bullet', async () => {
    const text = 'For shipping companies, lead with 24/7 multilingual deflection.';
    await add(text);
    const out = await list();
    expect(bullets(out)).toContain(`- ${text}`);
  });

  it('appends to an existing file without clobbering earlier bullets', async () => {
    await add('First preference.');
    await add('Second preference.');
    expect(bullets(await list())).toEqual(['- First preference.', '- Second preference.']);
  });

  it('is idempotent on exact match — adding the same text twice does not duplicate', async () => {
    await add('Prefer subject lines under 50 characters.');
    await add('Prefer subject lines under 50 characters.');
    expect(bullets(await list())).toEqual(['- Prefer subject lines under 50 characters.']);
  });
});

describe('removePreference', () => {
  it('removes a bullet by case-insensitive substring match', async () => {
    await add('Always include hiring trajectory.');
    await add('Prefer subject lines under 50 characters.');
    await remove('HIRING TRAJECTORY');
    expect(bullets(await list())).toEqual(['- Prefer subject lines under 50 characters.']);
  });

  it('removes only the first match when several bullets match', async () => {
    await add('Lead with multilingual for shipping.');
    await add('Lead with multilingual for airlines.');
    await remove('multilingual');
    expect(bullets(await list())).toEqual(['- Lead with multilingual for airlines.']);
  });

  it('leaves the file unchanged when nothing matches', async () => {
    await add('Prefer subject lines under 50 characters.');
    const before = await list();
    await remove('no such preference');
    expect(await list()).toBe(before);
  });
});

describe('test hygiene', () => {
  it('leaves no preferences.md behind when none existed before (first test sets baseline)', async () => {
    await add('Temporary.');
    expect(existsSync(PREFS_PATH)).toBe(true);
  });

  it('starts each test with a clean slate', async () => {
    expect(await list()).toBe('');
  });
});
