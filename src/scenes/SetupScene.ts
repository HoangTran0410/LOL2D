import { Scene } from '../managers/SceneManager';
import AssetManager from '../managers/AssetManager';
import {
  listSelectableChampions,
  listSummonerSpells,
  type SelectableChampion,
  type SummonerSpellOption,
} from '../game/preset';
import {
  loadPregameConfig,
  savePregameConfig,
  sanitizePregameConfig,
  DEFAULT_PREGAME_CONFIG,
  AI_COUNT_MIN,
  AI_COUNT_MAX,
  CDR_PERCENT_MIN,
  CDR_PERCENT_MAX,
  type PregameConfig,
} from '../game/config/PregameConfig';
import GameScene from './GameScene';
import MenuScene from './MenuScene';

/**
 * The pregame setup screen: pick a champion (and its bundled Q/W/E/R kit),
 * pick both summoner spells, configure the AI bots, and set match-wide rules
 * (cooldown reduction, URF). Every control writes straight through to
 * `localStorage` on change via `savePregameConfig` — there is no separate
 * "Save" step, so leaving through "Quay lại", the browser back button, or a
 * tab close all keep whatever was last touched.
 *
 * `Game.ts` reads the persisted config once, at construction — this scene
 * never reaches into a running game, and a running game never reaches back
 * here. "Bắt đầu" is deliberately identical to the menu's own "Chơi" button:
 * both just show `GameScene`, which is what keeps Play a one-click path from
 * the menu whether or not a player ever opens this screen.
 *
 * A standalone DOM UI, built directly on `preset.ts` — it does not reuse or
 * touch the in-game spell-picker modal in `InGameHUD.ts`.
 */
export default class SetupScene extends Scene {
  private root!: HTMLElement;
  private championGrid!: HTMLElement;
  private summonerRows!: Record<'D' | 'F', HTMLElement>;
  private aiCountInput!: HTMLInputElement;
  private aiCountValue!: HTMLElement;
  private aiAutoMoveInput!: HTMLInputElement;
  private aiAutoAttackInput!: HTMLInputElement;
  private aiAutoCastInput!: HTMLInputElement;
  private cdrInput!: HTMLInputElement;
  private cdrValue!: HTMLElement;
  private urfInput!: HTMLInputElement;

  private champions: SelectableChampion[] = [];
  private summoners: SummonerSpellOption[] = [];
  private config: PregameConfig = sanitizePregameConfig(DEFAULT_PREGAME_CONFIG);

  setup() {
    this.root = document.querySelector('#pregame-scene') as HTMLElement;
    this.championGrid = document.querySelector('#pregame-champion-grid') as HTMLElement;
    this.summonerRows = {
      D: document.querySelector('#pregame-summoner-d') as HTMLElement,
      F: document.querySelector('#pregame-summoner-f') as HTMLElement,
    };
    this.aiCountInput = document.querySelector('#pregame-ai-count') as HTMLInputElement;
    this.aiCountValue = document.querySelector('#pregame-ai-count-value') as HTMLElement;
    this.aiAutoMoveInput = document.querySelector('#pregame-ai-automove') as HTMLInputElement;
    this.aiAutoAttackInput = document.querySelector('#pregame-ai-autoattack') as HTMLInputElement;
    this.aiAutoCastInput = document.querySelector('#pregame-ai-autocast') as HTMLInputElement;
    this.cdrInput = document.querySelector('#pregame-cdr') as HTMLInputElement;
    this.cdrValue = document.querySelector('#pregame-cdr-value') as HTMLElement;
    this.urfInput = document.querySelector('#pregame-urf') as HTMLInputElement;

    this.aiCountInput.min = String(AI_COUNT_MIN);
    this.aiCountInput.max = String(AI_COUNT_MAX);
    this.cdrInput.min = String(CDR_PERCENT_MIN);
    this.cdrInput.max = String(CDR_PERCENT_MAX);

    // Champion cards and summoner options are built from `preset.ts`'s
    // catalog, which doesn't change at runtime — built once here rather than
    // on every `enter()`.
    this.champions = listSelectableChampions();
    this.summoners = listSummonerSpells();
    this.buildChampionGrid();
    this.buildSummonerRow('D');
    this.buildSummonerRow('F');

    this.wireControls();

    (document.querySelector('#pregame-back-btn') as HTMLElement).addEventListener('click', () => {
      this.sceneManager.showScene(MenuScene);
    });
    (document.querySelector('#pregame-reset-btn') as HTMLElement).addEventListener('click', () => {
      this.config = sanitizePregameConfig(DEFAULT_PREGAME_CONFIG);
      savePregameConfig(this.config);
      this.applyConfigToControls();
    });
    (document.querySelector('#pregame-start-btn') as HTMLElement).addEventListener('click', () => {
      this.sceneManager.showScene(GameScene);
    });
  }

  enter() {
    this.root.style.display = 'flex';
    this.config = loadPregameConfig();
    this.applyConfigToControls();
  }

  exit() {
    this.root.style.display = 'none';
  }

  // ------------------------------------------------------------ building

  private buildChampionGrid(): void {
    const randomCard = this.makeChampionCard(null);
    this.championGrid.appendChild(randomCard);
    for (const champion of this.champions) {
      this.championGrid.appendChild(this.makeChampionCard(champion));
    }
  }

  private makeChampionCard(champion: SelectableChampion | null): HTMLButtonElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'champion-card';
    card.dataset.champion = champion ? champion.name : 'random';

    const portrait = document.createElement('div');
    portrait.className = 'champion-portrait';
    if (champion) {
      const img = document.createElement('img');
      img.src = AssetManager.get(champion.avatar).url;
      img.alt = champion.name;
      portrait.appendChild(img);
    } else {
      portrait.classList.add('champion-portrait-random');
      portrait.innerHTML = '<i class="fas fa-random"></i>';
    }
    card.appendChild(portrait);

    const name = document.createElement('div');
    name.className = 'champion-name';
    name.textContent = champion ? champion.name : 'Ngẫu Nhiên';
    card.appendChild(name);

    if (champion) {
      const spells = document.createElement('div');
      spells.className = 'champion-spells';
      for (const spell of champion.spells) {
        const icon = document.createElement('img');
        icon.src = spell.iconUrl ?? AssetManager.placeholder(spell.name).url;
        icon.alt = spell.name;
        icon.title = spell.name;
        spells.appendChild(icon);
      }
      card.appendChild(spells);
    }

    card.addEventListener('click', () => {
      this.config = {
        ...this.config,
        player: { ...this.config.player, championName: card.dataset.champion as string },
      };
      savePregameConfig(this.config);
      this.updateChampionSelection();
    });

    return card;
  }

  private buildSummonerRow(slot: 'D' | 'F'): void {
    const row = this.summonerRows[slot];
    for (const summoner of this.summoners) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'summoner-option';
      button.dataset.summoner = summoner.id;
      const icon = document.createElement('img');
      icon.src = summoner.display.iconUrl ?? AssetManager.placeholder(summoner.display.name).url;
      icon.alt = summoner.display.name;
      icon.title = summoner.display.name;
      button.appendChild(icon);

      button.addEventListener('click', () => {
        const key = slot === 'D' ? 'summonerD' : 'summonerF';
        this.config = { ...this.config, player: { ...this.config.player, [key]: summoner.id } };
        savePregameConfig(this.config);
        this.updateSummonerSelection(slot);
      });

      row.appendChild(button);
    }
  }

  private wireControls(): void {
    this.aiCountInput.addEventListener('input', () => {
      const count = Number(this.aiCountInput.value);
      this.config = { ...this.config, ai: { ...this.config.ai, count } };
      this.aiCountValue.textContent = String(count);
      savePregameConfig(this.config);
    });

    this.aiAutoMoveInput.addEventListener('change', () => {
      this.config = {
        ...this.config,
        ai: { ...this.config.ai, autoMove: this.aiAutoMoveInput.checked },
      };
      savePregameConfig(this.config);
    });
    this.aiAutoAttackInput.addEventListener('change', () => {
      this.config = {
        ...this.config,
        ai: { ...this.config.ai, autoAttack: this.aiAutoAttackInput.checked },
      };
      savePregameConfig(this.config);
    });
    this.aiAutoCastInput.addEventListener('change', () => {
      this.config = {
        ...this.config,
        ai: { ...this.config.ai, autoCast: this.aiAutoCastInput.checked },
      };
      savePregameConfig(this.config);
    });

    this.cdrInput.addEventListener('input', () => {
      const percent = Number(this.cdrInput.value);
      this.config = {
        ...this.config,
        rules: { ...this.config.rules, cooldownReductionPercent: percent },
      };
      this.cdrValue.textContent = `${percent}%`;
      savePregameConfig(this.config);
    });
    this.urfInput.addEventListener('change', () => {
      this.config = { ...this.config, rules: { ...this.config.rules, manaFree: this.urfInput.checked } };
      savePregameConfig(this.config);
    });
  }

  // ------------------------------------------------------------ syncing

  private applyConfigToControls(): void {
    this.updateChampionSelection();
    this.updateSummonerSelection('D');
    this.updateSummonerSelection('F');

    this.aiCountInput.value = String(this.config.ai.count);
    this.aiCountValue.textContent = String(this.config.ai.count);
    this.aiAutoMoveInput.checked = this.config.ai.autoMove;
    this.aiAutoAttackInput.checked = this.config.ai.autoAttack;
    this.aiAutoCastInput.checked = this.config.ai.autoCast;

    this.cdrInput.value = String(this.config.rules.cooldownReductionPercent);
    this.cdrValue.textContent = `${this.config.rules.cooldownReductionPercent}%`;
    this.urfInput.checked = this.config.rules.manaFree;
  }

  private updateChampionSelection(): void {
    const cards = this.championGrid.querySelectorAll<HTMLElement>('.champion-card');
    cards.forEach(card => {
      card.classList.toggle('selected', card.dataset.champion === this.config.player.championName);
    });
  }

  private updateSummonerSelection(slot: 'D' | 'F'): void {
    const selectedId = slot === 'D' ? this.config.player.summonerD : this.config.player.summonerF;
    const buttons = this.summonerRows[slot].querySelectorAll<HTMLElement>('.summoner-option');
    buttons.forEach(button => {
      button.classList.toggle('selected', button.dataset.summoner === selectedId);
    });
  }
}
