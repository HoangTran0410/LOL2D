const TeamId = {
  TEAM_UNKNOWN: 0x0,
  TEAM_BLUE: 0x64, // 100
  TEAM_PURPLE: 0xc8, // 200
  TEAM_NEUTRAL: 0x12c, // 300
  TEAM_MAX: 0x190, // 400
  TEAM_ALL: 0xffffff9c,
};

Object.freeze(TeamId);

export default TeamId;
