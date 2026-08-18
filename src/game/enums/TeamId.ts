/**
 * The two lane teams.
 *
 * `GameObject.teamId` remains a string that defaults to a fresh uuid per unit,
 * preserving isolated FFA objects and lightweight fixtures. A running match
 * assigns every champion one of these shared ids explicitly; the same id then
 * joins a champion to its fountain, turret row, minions, pets and spell objects.
 *
 * The values are plain strings because that is what `teamId` is. This file used
 * to hold numeric TEAM_BLUE/TEAM_PURPLE/TEAM_NEUTRAL constants lifted from the
 * League server enum; nothing read them, and they could never have been assigned
 * to a `teamId` in the first place.
 */
import { MatchTeam } from '../config/MatchTeams';

const TeamId = MatchTeam;
export default TeamId;

/** The side of the map a team spawns from — blue is bottom-left, red top-right. */
export const opposingTeam = (teamId: string): string =>
  teamId === TeamId.BLUE ? TeamId.RED : TeamId.BLUE;
