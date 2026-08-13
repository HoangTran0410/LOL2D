/**
 * The two lane teams.
 *
 * `GameObject.teamId` is a string that defaults to a fresh uuid per unit, so out
 * of the box every unit is its own faction and `canTakeDamageFromTeam` reduces
 * to "not me". Champions still work exactly that way on purpose — the player and
 * the bots stay free-for-all and are hostile to both minion teams. These two
 * shared ids are only what puts a base's fountain, its turret row and the
 * minions it spawns on one side.
 *
 * The values are plain strings because that is what `teamId` is. This file used
 * to hold numeric TEAM_BLUE/TEAM_PURPLE/TEAM_NEUTRAL constants lifted from the
 * League server enum; nothing read them, and they could never have been assigned
 * to a `teamId` in the first place.
 */
const TeamId = {
  BLUE: 'team-blue',
  RED: 'team-red',
};
Object.freeze(TeamId);
export default TeamId as typeof TeamId;

/** The side of the map a team spawns from — blue is bottom-left, red top-right. */
export const opposingTeam = (teamId: string): string =>
  teamId === TeamId.BLUE ? TeamId.RED : TeamId.BLUE;
