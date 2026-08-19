import { describe, expect, it } from 'vitest';
import gameSource from '../../../src/game/Game.ts?raw';

const executableSource = gameSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('production match composition seam', () => {
  it('boots the player and every bot from its persisted lane team', () => {
    // The player's side is a match setting now (Blue by default), read the same
    // way each bot's is — so boot must go through the config, not a hardcoded
    // TeamId.BLUE, or a persisted player-team switch would be silently ignored.
    expect(executableSource).toContain('const playerTeam = pregameConfig.playerTeam');
    expect(executableSource).toMatch(
      /new Champion\(\{[\s\S]*?position:\s*this\.randomSpawnPoint\(playerTeam\)[\s\S]*?teamId:\s*playerTeam/
    );
    expect(executableSource).toContain('const botTeam = pregameConfig.ai.botTeams[i]');
    expect(executableSource).toMatch(
      /new AIChampion\(\{[\s\S]*?position:\s*this\.randomSpawnPoint\(botTeam\)[\s\S]*?teamId:\s*botTeam/
    );
  });
});
