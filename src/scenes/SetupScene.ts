import { Scene } from '../managers/SceneManager';
import AssetManager from '../managers/AssetManager';
import { SpellHotKeys } from '../game/constants';
import {
  listSelectableChampions,
  listSummonerSpells,
  listSpellCatalog,
  getSpellDisplay,
  SpellGroups,
  type SelectableChampion,
  type SummonerSpellOption,
  type SpellCatalogEntry,
} from '../game/preset';
import {
  loadPregameConfig,
  savePregameConfig,
  sanitizePregameConfig,
  sanitizeChampionLoadout,
  toMatchRules,
  DEFAULT_PREGAME_CONFIG,
  AI_COUNT_MIN,
  AI_COUNT_MAX,
  CDR_PERCENT_MIN,
  CDR_PERCENT_MAX,
  SLOT_COUNT,
  type PregameConfig,
  type ChampionLoadout,
  type SlotChoice,
  type MatchRules,
} from '../game/config/PregameConfig';
import GameScene from './GameScene';
import MenuScene from './MenuScene';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpellClass = any;

/** A, Q, W, E, R, D, F — same order and source as the real in-game hotkeys. */
const SLOT_LABELS = SpellHotKeys.map(code => String.fromCharCode(code));

interface LoadoutEditorHandle {
  refresh(): void;
}

/**
 * The pregame setup screen: pick a champion (bundled Q/W/E/R kit) or build a
 * kit slot by slot from the whole spell catalogue, pick summoner spells,
 * configure each AI bot's champion/kit individually (plus the AI behaviour
 * flags shared by all of them), and set match-wide rules (cooldown
 * reduction, URF). Every control writes straight through to `localStorage`
 * on change via `savePregameConfig` — there is no separate "Save" step, so
 * leaving through "Quay lại", the browser back button, or a tab close all
 * keep whatever was last touched.
 *
 * `Game.ts` reads the persisted config once, at construction — this scene
 * never reaches into a running game, and a running game never reaches back
 * here. "Bắt đầu" is deliberately identical to the menu's own "Chơi" button:
 * both just show `GameScene`, which is what keeps Play a one-click path from
 * the menu whether or not a player ever opens this screen.
 *
 * A standalone DOM UI, built directly on `preset.ts` — it does not reuse or
 * touch the in-game spell-picker modal in `InGameHUD.ts`.
 *
 * The champion-pick UI (`mountLoadoutEditor`) is mounted once for the player
 * and, on demand, into whichever AI bot row is expanded in the "Cấu Hình
 * Từng Bot AI" accordion — one implementation, reused, rather than one
 * player-specific copy and one bot-specific copy.
 */
export default class SetupScene extends Scene {
  private root!: HTMLElement;
  private playerEditorContainer!: HTMLElement;
  private botListContainer!: HTMLElement;
  private aiCountInput!: HTMLInputElement;
  private aiCountValue!: HTMLElement;
  private aiAutoMoveInput!: HTMLInputElement;
  private aiAutoAttackInput!: HTMLInputElement;
  private aiAutoCastInput!: HTMLInputElement;
  private cdrInput!: HTMLInputElement;
  private cdrValue!: HTMLElement;
  private urfInput!: HTMLInputElement;

  private catalogPicker!: HTMLElement;
  private catalogTitle!: HTMLElement;
  private catalogContent!: HTMLElement;

  private spellDetailPanel!: HTMLElement;
  private detailIcon!: HTMLImageElement;
  private detailName!: HTMLElement;
  private detailCooldown!: HTMLElement;
  private detailMana!: HTMLElement;
  private detailDescription!: HTMLElement;

  private champions: SelectableChampion[] = [];
  private summoners: SummonerSpellOption[] = [];
  private spellCatalog: SpellCatalogEntry[] = [];
  /** `SpellCatalogEntry`, keyed by spell class reference — built once alongside `spellCatalog`. */
  private catalogByClass = new Map<SpellClass, SpellCatalogEntry>();

  private config: PregameConfig = sanitizePregameConfig(DEFAULT_PREGAME_CONFIG);

  private playerEditor?: LoadoutEditorHandle;
  /** Which bot row is expanded, if any — accordion: at most one at a time. */
  private expandedBotIndex: number | null = null;
  private expandedBotEditor?: LoadoutEditorHandle;

  /** The spell currently shown in the detail panel, so a CDR/URF change can refresh it live. */
  private detailSpellClass: SpellClass | null = null;

  setup() {
    this.root = document.querySelector('#pregame-scene') as HTMLElement;
    this.playerEditorContainer = document.querySelector('#pregame-player-editor') as HTMLElement;
    this.botListContainer = document.querySelector('#pregame-bot-list') as HTMLElement;
    this.aiCountInput = document.querySelector('#pregame-ai-count') as HTMLInputElement;
    this.aiCountValue = document.querySelector('#pregame-ai-count-value') as HTMLElement;
    this.aiAutoMoveInput = document.querySelector('#pregame-ai-automove') as HTMLInputElement;
    this.aiAutoAttackInput = document.querySelector('#pregame-ai-autoattack') as HTMLInputElement;
    this.aiAutoCastInput = document.querySelector('#pregame-ai-autocast') as HTMLInputElement;
    this.cdrInput = document.querySelector('#pregame-cdr') as HTMLInputElement;
    this.cdrValue = document.querySelector('#pregame-cdr-value') as HTMLElement;
    this.urfInput = document.querySelector('#pregame-urf') as HTMLInputElement;

    this.catalogPicker = document.querySelector('#pregame-catalog-picker') as HTMLElement;
    this.catalogTitle = document.querySelector('#pregame-catalog-title') as HTMLElement;
    this.catalogContent = document.querySelector('#pregame-catalog-content') as HTMLElement;

    this.spellDetailPanel = document.querySelector('#pregame-spell-detail') as HTMLElement;
    this.detailIcon = document.querySelector('#pregame-detail-icon') as HTMLImageElement;
    this.detailName = document.querySelector('#pregame-detail-name') as HTMLElement;
    this.detailCooldown = document.querySelector('#pregame-detail-cooldown') as HTMLElement;
    this.detailMana = document.querySelector('#pregame-detail-mana') as HTMLElement;
    this.detailDescription = document.querySelector('#pregame-detail-description') as HTMLElement;

    this.aiCountInput.min = String(AI_COUNT_MIN);
    this.aiCountInput.max = String(AI_COUNT_MAX);
    this.cdrInput.min = String(CDR_PERCENT_MIN);
    this.cdrInput.max = String(CDR_PERCENT_MAX);

    // preset.ts's catalogue doesn't change at runtime — built once here
    // rather than on every enter()/render().
    this.champions = listSelectableChampions();
    this.summoners = listSummonerSpells();
    this.spellCatalog = listSpellCatalog();
    this.catalogByClass = new Map(this.spellCatalog.map(entry => [entry.spellClass, entry]));

    this.playerEditor = this.mountLoadoutEditor(
      this.playerEditorContainer,
      () => this.config.player,
      loadout => {
        this.config = { ...this.config, player: loadout };
        this.persist();
      }
    );

    this.wireAiAndRulesControls();
    this.wireOverlays();

    (document.querySelector('#pregame-back-btn') as HTMLElement).addEventListener('click', () => {
      this.sceneManager.showScene(MenuScene);
    });
    (document.querySelector('#pregame-reset-btn') as HTMLElement).addEventListener('click', () => {
      this.config = sanitizePregameConfig(DEFAULT_PREGAME_CONFIG);
      savePregameConfig(this.config);
      this.expandedBotIndex = null;
      this.applyConfigToControls();
    });
    (document.querySelector('#pregame-start-btn') as HTMLElement).addEventListener('click', () => {
      this.sceneManager.showScene(GameScene);
    });
  }

  enter() {
    this.root.style.display = 'flex';
    this.config = loadPregameConfig();
    this.expandedBotIndex = null;
    this.closeCatalogPicker();
    this.closeSpellDetail();
    this.applyConfigToControls();
  }

  exit() {
    this.root.style.display = 'none';
  }

  private persist(): void {
    savePregameConfig(this.config);
    this.refreshSpellDetailIfOpen();
  }

  private currentMatchRules(): MatchRules {
    return toMatchRules(this.config.rules);
  }

  // ------------------------------------------------------------ top-level sync

  private applyConfigToControls(): void {
    this.playerEditor?.refresh();
    this.buildBotList();

    this.aiCountInput.value = String(this.config.ai.count);
    this.aiCountValue.textContent = String(this.config.ai.count);
    this.aiAutoMoveInput.checked = this.config.ai.autoMove;
    this.aiAutoAttackInput.checked = this.config.ai.autoAttack;
    this.aiAutoCastInput.checked = this.config.ai.autoCast;

    this.cdrInput.value = String(this.config.rules.cooldownReductionPercent);
    this.cdrValue.textContent = `${this.config.rules.cooldownReductionPercent}%`;
    this.urfInput.checked = this.config.rules.manaFree;
  }

  private wireAiAndRulesControls(): void {
    this.aiCountInput.addEventListener('input', () => {
      const count = Number(this.aiCountInput.value);
      this.config = { ...this.config, ai: { ...this.config.ai, count } };
      this.aiCountValue.textContent = String(count);
      this.persist();
      // Rows beyond the new count disappear, and the accordion can't keep an
      // editor open in a row that no longer exists.
      if (this.expandedBotIndex !== null && this.expandedBotIndex >= count) {
        this.expandedBotIndex = null;
      }
      this.buildBotList();
    });

    this.aiAutoMoveInput.addEventListener('change', () => {
      this.config = { ...this.config, ai: { ...this.config.ai, autoMove: this.aiAutoMoveInput.checked } };
      this.persist();
    });
    this.aiAutoAttackInput.addEventListener('change', () => {
      this.config = {
        ...this.config,
        ai: { ...this.config.ai, autoAttack: this.aiAutoAttackInput.checked },
      };
      this.persist();
    });
    this.aiAutoCastInput.addEventListener('change', () => {
      this.config = { ...this.config, ai: { ...this.config.ai, autoCast: this.aiAutoCastInput.checked } };
      this.persist();
    });

    this.cdrInput.addEventListener('input', () => {
      const percent = Number(this.cdrInput.value);
      this.config = { ...this.config, rules: { ...this.config.rules, cooldownReductionPercent: percent } };
      this.cdrValue.textContent = `${percent}%`;
      this.persist();
    });
    this.urfInput.addEventListener('change', () => {
      this.config = { ...this.config, rules: { ...this.config.rules, manaFree: this.urfInput.checked } };
      this.persist();
    });
  }

  private wireOverlays(): void {
    (document.querySelector('#pregame-catalog-close') as HTMLElement).addEventListener('click', () => {
      this.closeCatalogPicker();
    });
    this.catalogPicker.addEventListener('click', event => {
      if (event.target === this.catalogPicker) this.closeCatalogPicker();
    });
    (document.querySelector('#pregame-detail-close') as HTMLElement).addEventListener('click', () => {
      this.closeSpellDetail();
    });
    this.spellDetailPanel.addEventListener('click', event => {
      if (event.target === this.spellDetailPanel) this.closeSpellDetail();
    });
  }

  // ------------------------------------------------------------ loadout editor
  // Shared by the player's own section (mounted once) and by whichever AI bot
  // row is expanded (mounted/torn down on demand) — see buildBotList().

  private mountLoadoutEditor(
    container: HTMLElement,
    getLoadout: () => ChampionLoadout,
    setLoadout: (loadout: ChampionLoadout) => void
  ): LoadoutEditorHandle {
    container.innerHTML = '';

    const toggle = document.createElement('div');
    toggle.className = 'kit-mode-toggle';
    const champModeBtn = document.createElement('button');
    champModeBtn.type = 'button';
    champModeBtn.className = 'kit-mode-btn';
    champModeBtn.textContent = 'Chọn Tướng';
    const customModeBtn = document.createElement('button');
    customModeBtn.type = 'button';
    customModeBtn.className = 'kit-mode-btn';
    customModeBtn.textContent = 'Tự Ghép Chiêu';
    toggle.append(champModeBtn, customModeBtn);
    container.appendChild(toggle);

    const champPanel = document.createElement('div');
    champPanel.className = 'kit-mode-panel';
    const grid = document.createElement('div');
    grid.className = 'champion-grid';
    champPanel.appendChild(grid);

    const summonerRow = document.createElement('div');
    summonerRow.className = 'summoner-row';
    const summonerDSlot = this.buildSummonerSlotShell('D');
    const summonerFSlot = this.buildSummonerSlotShell('F');
    summonerRow.append(summonerDSlot.root, summonerFSlot.root);
    champPanel.appendChild(summonerRow);
    container.appendChild(champPanel);

    const customPanel = document.createElement('div');
    customPanel.className = 'kit-mode-panel';
    const hint = document.createElement('p');
    hint.className = 'custom-slot-hint';
    hint.textContent =
      'Ô A là đòn đánh thường: đổi ô này đổi luôn phím tấn công và nhịp đánh của tướng, không chỉ thêm một chiêu mới.';
    customPanel.appendChild(hint);
    const slotRow = document.createElement('div');
    slotRow.className = 'custom-slot-row';
    customPanel.appendChild(slotRow);
    container.appendChild(customPanel);

    const render = (): void => {
      const loadout = getLoadout();
      champModeBtn.classList.toggle('selected', loadout.mode === 'champion');
      customModeBtn.classList.toggle('selected', loadout.mode === 'custom');
      champPanel.hidden = loadout.mode !== 'champion';
      customPanel.hidden = loadout.mode !== 'custom';

      grid.querySelectorAll<HTMLElement>('.champion-card').forEach(card => {
        card.classList.toggle('selected', card.dataset.champion === loadout.championName);
      });
      summonerDSlot.update(loadout.summonerD);
      summonerFSlot.update(loadout.summonerF);

      slotRow.innerHTML = '';
      for (let i = 0; i < SLOT_COUNT; i++) {
        slotRow.appendChild(
          this.buildCustomSlotButton(i, loadout, next => {
            setLoadout(next);
            render();
          })
        );
      }
    };

    champModeBtn.addEventListener('click', () => {
      setLoadout({ ...getLoadout(), mode: 'champion' });
      render();
    });
    customModeBtn.addEventListener('click', () => {
      setLoadout({ ...getLoadout(), mode: 'custom' });
      render();
    });

    this.appendChampionCards(grid, championName => {
      setLoadout({ ...getLoadout(), mode: 'champion', championName });
      render();
    });
    summonerDSlot.wire(id => {
      setLoadout({ ...getLoadout(), summonerD: id });
      render();
    });
    summonerFSlot.wire(id => {
      setLoadout({ ...getLoadout(), summonerF: id });
      render();
    });

    render();
    return { refresh: render };
  }

  private appendChampionCards(grid: HTMLElement, onPick: (championName: string) => void): void {
    grid.appendChild(this.makeChampionCard(null, onPick));
    for (const champion of this.champions) grid.appendChild(this.makeChampionCard(champion, onPick));
  }

  private makeChampionCard(
    champion: SelectableChampion | null,
    onPick: (championName: string) => void
  ): HTMLButtonElement {
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
      for (const { spellClass, display } of champion.spells) {
        const icon = document.createElement('img');
        icon.src = display.iconUrl ?? AssetManager.placeholder(display.name).url;
        icon.alt = display.name;
        icon.title = display.name;
        // Tap the icon: preview the ability. Tap the rest of the card: pick
        // the champion. No hover involved, so this works with a thumb too.
        icon.addEventListener('click', event => {
          event.stopPropagation();
          this.showSpellDetail(spellClass);
        });
        spells.appendChild(icon);
      }
      card.appendChild(spells);
    }

    card.addEventListener('click', () => onPick(card.dataset.champion as string));
    return card;
  }

  private buildSummonerSlotShell(slot: 'D' | 'F'): {
    root: HTMLElement;
    wire: (onPick: (id: string) => void) => void;
    update: (selectedId: string) => void;
  } {
    const root = document.createElement('div');
    root.className = 'summoner-slot';
    const label = document.createElement('span');
    label.className = 'summoner-slot-label';
    label.textContent = slot;
    root.appendChild(label);
    const options = document.createElement('div');
    options.className = 'summoner-options';
    root.appendChild(options);

    const buttons: HTMLButtonElement[] = [];
    const wire = (onPick: (id: string) => void): void => {
      for (const summoner of this.summoners) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'summoner-option';
        button.dataset.summoner = summoner.id;
        const icon = document.createElement('img');
        icon.src = summoner.display.iconUrl ?? AssetManager.placeholder(summoner.display.name).url;
        icon.alt = summoner.display.name;
        icon.title = summoner.display.name;
        icon.addEventListener('click', event => {
          event.stopPropagation();
          this.showSpellDetail(summoner.spellClass);
        });
        button.appendChild(icon);
        button.addEventListener('click', () => onPick(summoner.id));
        options.appendChild(button);
        buttons.push(button);
      }
    };
    const update = (selectedId: string): void => {
      for (const button of buttons) button.classList.toggle('selected', button.dataset.summoner === selectedId);
    };

    return { root, wire, update };
  }

  private buildCustomSlotButton(
    index: number,
    loadout: ChampionLoadout,
    onChange: (loadout: ChampionLoadout) => void
  ): HTMLButtonElement {
    const choice: SlotChoice = loadout.customSlots[index] ?? 'random';
    const entry = choice !== 'random' ? this.spellCatalog.find(e => e.id === choice) : undefined;

    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'custom-slot';

    const hotkey = document.createElement('span');
    hotkey.className = 'custom-slot-hotkey';
    hotkey.textContent = index === 0 ? `${SLOT_LABELS[0]} · ĐT` : SLOT_LABELS[index];
    hotkey.title = index === 0 ? 'Phím đòn đánh thường' : `Phím ${SLOT_LABELS[index]}`;
    slot.appendChild(hotkey);

    const iconWrap = document.createElement('div');
    iconWrap.className = 'custom-slot-icon';
    if (entry) {
      const img = document.createElement('img');
      img.src = entry.display.iconUrl ?? AssetManager.placeholder(entry.display.name).url;
      img.alt = entry.display.name;
      // Tap the icon: preview what's currently in this slot. Tap the rest of
      // the slot: open the picker to change it.
      img.addEventListener('click', event => {
        event.stopPropagation();
        this.showSpellDetail(entry.spellClass);
      });
      iconWrap.appendChild(img);
    } else {
      iconWrap.innerHTML = '<i class="fas fa-random"></i>';
    }
    slot.appendChild(iconWrap);

    const name = document.createElement('div');
    name.className = 'custom-slot-name';
    name.textContent = entry ? entry.display.name : 'Ngẫu Nhiên';
    slot.appendChild(name);

    slot.addEventListener('click', () => {
      this.openCatalogPicker(choice, picked => {
        const nextSlots = loadout.customSlots.slice();
        nextSlots[index] = picked;
        onChange({ ...loadout, customSlots: nextSlots });
      });
    });

    return slot;
  }

  // ------------------------------------------------------------ catalogue picker

  private openCatalogPicker(_current: SlotChoice, onPick: (choice: SlotChoice) => void): void {
    this.catalogContent.innerHTML = '';

    const randomCard = document.createElement('button');
    randomCard.type = 'button';
    randomCard.className = 'catalog-random-card';
    randomCard.innerHTML = '<i class="fas fa-random"></i> Ngẫu Nhiên';
    randomCard.addEventListener('click', () => {
      onPick('random');
      this.closeCatalogPicker();
    });
    this.catalogContent.appendChild(randomCard);

    for (const group of SpellGroups) {
      const spellsInGroup = (group.spells as SpellClass[])
        .map(spellClass => this.catalogByClass.get(spellClass))
        .filter((entry): entry is SpellCatalogEntry => !!entry);
      if (spellsInGroup.length === 0) continue;

      const heading = document.createElement('div');
      heading.className = 'catalog-group-heading';
      heading.textContent = group.name;
      this.catalogContent.appendChild(heading);

      const row = document.createElement('div');
      row.className = 'catalog-group-row';
      for (const entry of spellsInGroup) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'catalog-spell-card';

        const img = document.createElement('img');
        img.src = entry.display.iconUrl ?? AssetManager.placeholder(entry.display.name).url;
        img.alt = entry.display.name;
        img.addEventListener('click', event => {
          event.stopPropagation();
          this.showSpellDetail(entry.spellClass);
        });
        card.appendChild(img);

        const name = document.createElement('div');
        name.className = 'catalog-spell-name';
        name.textContent = entry.display.name;
        card.appendChild(name);

        card.addEventListener('click', () => {
          onPick(entry.id);
          this.closeCatalogPicker();
        });
        row.appendChild(card);
      }
      this.catalogContent.appendChild(row);
    }

    this.catalogPicker.hidden = false;
  }

  private closeCatalogPicker(): void {
    this.catalogPicker.hidden = true;
  }

  // ------------------------------------------------------------ spell detail panel

  private showSpellDetail(spellClass: SpellClass): void {
    this.detailSpellClass = spellClass;
    this.renderSpellDetail();
    this.spellDetailPanel.hidden = false;
  }

  private closeSpellDetail(): void {
    this.spellDetailPanel.hidden = true;
    this.detailSpellClass = null;
  }

  private refreshSpellDetailIfOpen(): void {
    if (this.detailSpellClass && !this.spellDetailPanel.hidden) this.renderSpellDetail();
  }

  /**
   * Reads `effectiveCoolDownMs`/`effectiveManaCost` off a real `Spell`
   * instance (via `getSpellDisplay`, using the *current* CDR/URF sliders) —
   * the same accessors the engine itself uses to run a cast — so a number
   * shown here is provably the number a real match under this config would
   * use, not a parallel re-implementation of the formula that could drift.
   */
  private renderSpellDetail(): void {
    if (!this.detailSpellClass) return;
    const display = getSpellDisplay(this.detailSpellClass, this.currentMatchRules());
    this.detailIcon.src = display.iconUrl ?? AssetManager.placeholder(display.name).url;
    this.detailIcon.alt = display.name;
    this.detailName.textContent = display.name;
    this.detailCooldown.textContent = `${(display.effectiveCoolDownMs / 1000).toFixed(1)}s`;
    this.detailMana.textContent = `${Math.round(display.effectiveManaCost)}`;
    this.detailDescription.innerHTML = display.description || '<em>Không có mô tả.</em>';
  }

  // ------------------------------------------------------------ per-bot AI config

  private buildBotList(): void {
    this.botListContainer.innerHTML = '';
    for (let i = 0; i < this.config.ai.count; i++) {
      this.botListContainer.appendChild(this.buildBotRow(i));
    }
  }

  private buildBotRow(index: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bot-row';
    const expanded = this.expandedBotIndex === index;
    row.classList.toggle('expanded', expanded);

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'bot-row-header';

    const label = document.createElement('span');
    label.className = 'bot-row-label';
    label.textContent = `Bot ${index + 1}`;
    header.appendChild(label);

    const summary = document.createElement('span');
    summary.className = 'bot-row-summary';
    summary.textContent = this.botSummaryText(this.config.ai.bots[index]);
    header.appendChild(summary);

    const chevron = document.createElement('i');
    chevron.className = 'fas fa-chevron-down';
    header.appendChild(chevron);
    row.appendChild(header);

    const editorContainer = document.createElement('div');
    editorContainer.className = 'bot-row-editor';
    editorContainer.hidden = !expanded;
    row.appendChild(editorContainer);

    header.addEventListener('click', () => {
      if (this.expandedBotIndex === index) {
        this.expandedBotIndex = null;
        this.expandedBotEditor = undefined;
        this.buildBotList();
        return;
      }
      this.expandedBotIndex = index;
      this.buildBotList();
    });

    if (expanded) {
      this.expandedBotEditor = this.mountLoadoutEditor(
        editorContainer,
        () => this.config.ai.bots[index],
        loadout => {
          const bots = this.config.ai.bots.slice();
          bots[index] = loadout;
          this.config = { ...this.config, ai: { ...this.config.ai, bots } };
          this.persist();
          summary.textContent = this.botSummaryText(loadout);
        }
      );
    }

    return row;
  }

  private botSummaryText(loadout: ChampionLoadout): string {
    if (loadout.mode === 'custom') return 'Tự Ghép Chiêu';
    if (loadout.championName === 'random') return 'Ngẫu Nhiên';
    return loadout.championName;
  }
}
