// Type declaration for stats.js (used via CDN, not installed as npm package)
declare module 'stats' {
  class Stats {
    dom: HTMLElement;
    showPanel(id: number): void;
    begin(): void;
    end(): void;
  }
  export = Stats;
}
