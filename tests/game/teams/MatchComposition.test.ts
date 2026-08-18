import { describe, expect, it } from 'vitest';
import gameSource from '../../../src/game/Game.ts?raw';

const executableSource = gameSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('production match composition seam', () => {
  it('gives the player Blue and boots every bot from its persisted lane team', () => {
    expect(executableSource).toMatch(
      /new Champion\(\{[\s\S]*?position:\s*this\.randomSpawnPoint\(TeamId\.BLUE\)[\s\S]*?teamId:\s*TeamId\.BLUE/
    );
    expect(executableSource).toContain('const botTeam = pregameConfig.ai.botTeams[i]');
    expect(executableSource).toMatch(
      /new AIChampion\(\{[\s\S]*?position:\s*this\.randomSpawnPoint\(botTeam\)[\s\S]*?teamId:\s*botTeam/
    );
  });
});
