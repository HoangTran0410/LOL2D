const FormatUtils = {
  addZero(n: number): string {
    return n < 10 ? '0' + n : String(n);
  },
  /**
   * A spell's cooldown in seconds, for display.
   *
   * Every surface that shows one used to divide by 1000 inline, which is fine
   * until a match applies cooldown reduction: `Spell.effectiveCoolDownMs` is
   * `coolDown * (1 - percent/100)`, and that is binary floating point — a
   * 3500ms ability at 90% CDR is 350.00000000000006ms, which renders as
   * `0.3500000000000001s`. Two decimals is finer than any cooldown in the game
   * is tuned to, and `parseFloat` drops the zeros a bare `toFixed` would leave
   * behind, so a 5s cooldown still reads "5" rather than "5.00".
   */
  spellSeconds(ms: number): string {
    if (!Number.isFinite(ms)) return '0';
    return String(parseFloat((ms / 1000).toFixed(2)));
  },
  abilityCountDown(cd: number): string {
    if (cd < 1000) return (cd / 1000).toFixed(1);
    if (cd < 60000) return Math.floor(cd / 1000).toString();
    const m = Math.floor(cd / 60000);
    const s = this.addZero(Math.floor((cd / 1000) % 60));
    return `${m}:${s}`;
  },
};
export default FormatUtils;
