import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  assertPcSource,
  championSkillForms,
  parseLuaData,
} from '../../scripts/wiki/lua-data.mjs';

const fixtureUrl = new URL('../fixtures/wiki/champion-data.lua', import.meta.url);
const unicodeFixtureUrl = new URL('../fixtures/wiki/unicode-champion-data.lua', import.meta.url);

describe('League Wiki Lua data', () => {
  it('converts the ChampionData Lua table without executing Lua', async () => {
    const data = parseLuaData(await readFile(fixtureUrl, 'utf8'));

    expect(data.Janna).toMatchObject({
      id: 40,
      name: 'Janna',
      enabled: true,
      resource: null,
      roles: ['Support', 'Mage'],
    });
  });

  it('preserves ordered multi-form skill slots', async () => {
    const data = parseLuaData(await readFile(fixtureUrl, 'utf8'));

    expect(championSkillForms(data.Janna, 'Q')).toEqual([
      'Howling Gale',
      'Howling Gale Recast',
    ]);
  });

  it('preserves UTF-8 punctuation and Vietnamese text exactly', async () => {
    const data = parseLuaData(await readFile(unicodeFixtureUrl, 'utf8'));

    expect(data.Janna.title).toBe('Janna’s Gió Mùa');
  });

  it('rejects calls, functions, index expressions, and duplicate keys', () => {
    for (const source of [
      'return os.execute("no")',
      'return function() end',
      'return value[key]',
      'return "not a table"',
      'return { name = "one", ["name"] = "two" }',
    ]) {
      expect(() => parseLuaData(source)).toThrow(/unsupported|duplicate/i);
    }
  });

  it('rejects WR Data and ChampionDataWR sources', () => {
    expect(() => assertPcSource('Template:WR Data Janna/Howling Gale')).toThrow(/wild rift/i);
    expect(() => assertPcSource('Module:ChampionDataWR/data')).toThrow(/wild rift/i);
    expect(() => assertPcSource('Template:Data Janna/Howling Gale')).not.toThrow();
  });
});
