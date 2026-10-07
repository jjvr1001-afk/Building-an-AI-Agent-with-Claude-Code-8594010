import { tool } from 'ai';
import { z } from 'zod';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PREFS_PATH = fileURLToPath(new URL('./preferences.md', import.meta.url));
const HEADER = '# Preferences';

function readFile(): string {
  return existsSync(PREFS_PATH) ? readFileSync(PREFS_PATH, 'utf8') : '';
}

export const listPreferences = tool({
  description:
    'Read the saved user preferences (a Markdown bullet list). Call this FIRST on every run and apply any matching preferences. Returns "" when none are saved.',
  inputSchema: z.object({}),
  execute: async (): Promise<string> => readFile(),
});

export const addPreference = tool({
  description:
    'Save a preference the user explicitly stated (e.g. "for shipping companies, lead with X"). Only call when the user states a preference — never invent one. Adding identical text twice is a no-op.',
  inputSchema: z.object({ text: z.string().min(1).describe('The preference, in the user\'s words.') }),
  execute: async ({ text }): Promise<string> => {
    const bullet = `- ${text.trim()}`;
    const existing = readFile();
    if (existing.split('\n').includes(bullet)) return `Already saved: ${text.trim()}`;
    const base = existing === '' ? `${HEADER}\n\n` : existing.endsWith('\n') ? existing : `${existing}\n`;
    writeFileSync(PREFS_PATH, `${base}${bullet}\n`);
    return `Saved preference: ${text.trim()}`;
  },
});

export const removePreference = tool({
  description:
    'Remove a saved preference when the user asks to forget it. Matches by case-insensitive substring; if several match, only the first is removed.',
  inputSchema: z.object({ text: z.string().min(1).describe('Text (or a distinctive part) of the preference to remove.') }),
  execute: async ({ text }): Promise<string> => {
    const needle = text.trim().toLowerCase();
    const lines = readFile().split('\n');
    const idx = lines.findIndex((l) => l.startsWith('- ') && l.toLowerCase().includes(needle));
    if (idx === -1) return `No matching preference for: ${text.trim()}`;
    const [removed] = lines.splice(idx, 1);
    writeFileSync(PREFS_PATH, lines.join('\n'));
    return `Removed preference: ${removed!.slice(2)}`;
  },
});
