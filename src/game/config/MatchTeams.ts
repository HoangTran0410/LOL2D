/**
 * The two shared lane teams as class-free data.
 *
 * This module lives under `game/config` deliberately: the pregame screen needs
 * to balance bot slots without pulling the match chunk into its roster UI.
 */
export const MatchTeam = Object.freeze({
  BLUE: 'team-blue',
  RED: 'team-red',
} as const);

export type MatchTeamId = (typeof MatchTeam)[keyof typeof MatchTeam];

interface TeamMember {
  teamId: string;
}

export const isMatchTeamId = (value: unknown): value is MatchTeamId =>
  value === MatchTeam.BLUE || value === MatchTeam.RED;

/** Initial matches alternate bots around a Blue player, starting with Red. */
export const initialBotTeam = (index: number): MatchTeamId =>
  index % 2 === 0 ? MatchTeam.RED : MatchTeam.BLUE;

/**
 * Live roster edits keep the two lane teams as even as possible. A tie goes to
 * Red because the human player owns the fixed Blue slot.
 *
 * One-off UUID teams are deliberately ignored: they remain valid for isolated
 * fixtures and FFA objects without influencing a two-team match roster.
 */
export const teamForAddedBot = (members: readonly TeamMember[]): MatchTeamId => {
  let blue = 0;
  let red = 0;

  for (const member of members) {
    if (member.teamId === MatchTeam.BLUE) blue++;
    else if (member.teamId === MatchTeam.RED) red++;
  }

  return blue < red ? MatchTeam.BLUE : MatchTeam.RED;
};
