import { describe, expect, it } from 'vitest';
import TeamId from '../../../src/game/enums/TeamId';
import { initialBotTeam, teamForAddedBot } from '../../../src/game/config/MatchTeams';

describe('match champion teams', () => {
  it('alternates the initial bots Red/Blue so the default roster is 2v2', () => {
    const botTeams = Array.from({ length: 3 }, (_, index) => initialBotTeam(index));

    expect(botTeams).toEqual([TeamId.RED, TeamId.BLUE, TeamId.RED]);

    const roster = [TeamId.BLUE, ...botTeams];
    expect(roster.filter(teamId => teamId === TeamId.BLUE)).toHaveLength(2);
    expect(roster.filter(teamId => teamId === TeamId.RED)).toHaveLength(2);
  });

  it('puts a newly added bot on the less populated team', () => {
    expect(teamForAddedBot([{ teamId: TeamId.BLUE }, { teamId: TeamId.RED }])).toBe(TeamId.RED);
    expect(
      teamForAddedBot([{ teamId: TeamId.BLUE }, { teamId: TeamId.RED }, { teamId: TeamId.RED }])
    ).toBe(TeamId.BLUE);
  });

  it('ignores FFA ids when balancing the two lane teams', () => {
    expect(
      teamForAddedBot([
        { teamId: TeamId.BLUE },
        { teamId: 'one-off-ffa-team' },
        { teamId: TeamId.RED },
      ])
    ).toBe(TeamId.RED);
  });
});
