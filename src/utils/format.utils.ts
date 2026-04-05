const FormatUtils = {
  addZero(n: number): string {
    return n < 10 ? '0' + n : String(n);
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
