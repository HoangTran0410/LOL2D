import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { assertPcSource, championSkillForms, parseLuaData } from '../../scripts/wiki/lua-data.mjs';

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

    expect(championSkillForms(data.Janna, 'Q')).toEqual(['Howling Gale', 'Howling Gale Recast']);
  });

  it('orders live explicit numeric-key skill forms and rejects malformed maps', () => {
    expect(championSkillForms({ skill_r: { 1: 'Final Spark' } }, 'R')).toEqual(['Final Spark']);
    expect(championSkillForms({ skill_q: { 1: 'First', 2: 'Recast' } }, 'Q')).toEqual([
      'First',
      'Recast',
    ]);
    expect(() => championSkillForms({ skill_q: { 0: 'Zero', 1: 'First' } }, 'Q')).toThrow(
      /invalid skill_q/i
    );
    expect(() => championSkillForms({ skill_q: { 1: 'First', 3: 'Third' } }, 'Q')).toThrow(
      /invalid skill_q/i
    );
    expect(() => championSkillForms({ skill_q: { 1: 'First', extra: 'Other' } }, 'Q')).toThrow(
      /invalid skill_q/i
    );
    expect(() => championSkillForms({ skill_q: { 1: 42 } }, 'Q')).toThrow(/invalid skill_q/i);
  });

  it('preserves UTF-8 punctuation and Vietnamese text exactly', async () => {
    const data = parseLuaData(await readFile(unicodeFixtureUrl, 'utf8'));

    expect(data.Janna.title).toBe('Janna’s Gió Mùa');
  });

  it('preserves negative numeric literals exactly', () => {
    expect(parseLuaData('return { offset = -42.5 }')).toEqual({ offset: -42.5 });
  });

  it('evaluates the current finite numeric champion-data expression', () => {
    expect(parseLuaData('return { hp_lvl = 84+1000/17 }')).toEqual({ hp_lvl: 84 + 1000 / 17 });
  });

  it('uses Lua source-order overwrite semantics and reports duplicate keys', () => {
    const warnings: string[] = [];
    const data = parseLuaData(
      `return {
      LeBlanc = { skill_i = {[1] = "Mirror Image", "Mirror Image 2"} },
      Viktor = { skill_r = {[1] = "Arcane Storm", [2] = "Arcane Storm 2", [2] = "Arcane Storm 3"} },
      repeated = { value = "old", ["value"] = "new" },
    }`,
      { warn: warning => warnings.push(warning) }
    );

    expect(data.LeBlanc.skill_i).toEqual({ 1: 'Mirror Image 2' });
    expect(data.Viktor.skill_r).toEqual({ 1: 'Arcane Storm', 2: 'Arcane Storm 3' });
    expect(data.repeated).toEqual({ value: 'new' });
    expect(warnings).toHaveLength(3);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/LeBlanc\.skill_i\[1\].*2:\d+.*2:\d+/),
        expect.stringMatching(/Viktor\.skill_r\[2\].*3:\d+.*3:\d+/),
        expect.stringMatching(/repeated\.value.*4:\d+.*4:\d+/),
      ])
    );
  });

  it('rejects distinct Lua keys that alias as JavaScript object keys', () => {
    expect(() => parseLuaData('return { [1] = "number", ["1"] = "string" }')).toThrow(
      /normalized lua key collision/i
    );
  });

  it('rejects calls, functions, index expressions, and duplicate keys', () => {
    for (const source of [
      'return os.execute("no")',
      'return function() end',
      'return value[key]',
      'return "not a table"',
      'return { value = not 1 }',
      'return { value = #{} }',
      'return { value = ~1 }',
      'return { value = 2-1 }',
      'return { value = 2*3 }',
      'return { value = 1/0 }',
      'return { value = 1+other }',
      'return { value = 1+make() }',
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
