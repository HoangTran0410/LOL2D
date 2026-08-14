/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The "pick a spell" modal. One component, shared by `DesktopHudView` and
 * `MobileHudView` — the loadout it lets you assemble is the same game feature
 * in both modes, and CSS alone (`body.touch-ui .spell-picker` in
 * `styles/hud.css`) already does the resizing a phone needs. Forking this
 * into two copies would just be two places to keep the champion roster
 * markup in sync for no reason.
 *
 * What *is* mode-specific is reachability, and all of it is handled here:
 *
 *   - every actionable element binds both `@click` (the mouse) and a
 *     touch-native handler (see `hudInteractions.ts`'s file comment for why
 *     `click` alone does not fire under a real thumb);
 *   - the list scrolls by hand (`scrollTouchStart`/`scrollTouchMove`) because
 *     the same reason click is suppressed — `GameScene`'s canvas-wide
 *     `preventDefault()` on touch — also suppresses the browser's native
 *     touch-scroll, everywhere on the page, not just on the canvas.
 *
 * The close button sits in a `.close-btn-anchor` — a zero-height,
 * `position: sticky` wrapper — rather than directly in `.spell-picker`.
 * It used to be a plain `position: absolute` child of the scrolling
 * `.spell-picker` itself, which meant scrolling down through the roster
 * scrolled the close button away with it: the one way out of the modal
 * became unreachable exactly when a long roster gave a player the most
 * reason to want it. Caught by driving a real scroll gesture in
 * `tests/e2e/drive-mobile-hud.mjs` and then trying to tap the button
 * afterwards, not by reading the markup.
 *
 * A first fix split the modal into a fixed shell plus a `flex: 1 1 0`
 * scrolling body — the standard "sticky header" flex pattern. It does not
 * work here: `.spell-picker`'s height is `max-height`-capped but otherwise
 * intrinsic (auto), and `flex-grow` only has space to distribute once a flex
 * container is *already* pinned to a size larger than its content demands.
 * With nothing forcing that, the `flex-basis: 0` body resolved to zero
 * height and the whole list disappeared — worse than the bug it was meant to
 * fix, and only visible by actually loading the page, not from the CSS
 * alone. `position: sticky` sidesteps the whole question: it needs nothing
 * from its container but *a* scrolling ancestor, which `.spell-picker`
 * (unchanged, still just `overflow-y: auto` on itself) already is.
 */
export default {
  inject: ['hud'],

  data() {
    return {
      scrollTouchId: null as number | null,
      scrollStartY: 0,
      scrollStartTop: 0,
    };
  },

  methods: {
    scrollTouchStart(event: TouchEvent): void {
      const touch = event.touches[0];
      if (!touch) return;
      this.scrollTouchId = touch.identifier;
      this.scrollStartY = touch.clientY;
      this.scrollStartTop = (event.currentTarget as HTMLElement).scrollTop;
    },
    scrollTouchMove(event: TouchEvent): void {
      const touch = [...event.touches].find(t => t.identifier === this.scrollTouchId);
      if (!touch) return;
      const dy = touch.clientY - this.scrollStartY;
      (event.currentTarget as HTMLElement).scrollTop = this.scrollStartTop - dy;
    },
  },

  template: /*html*/ `
  <div class="spell-picker" @touchstart="scrollTouchStart" @touchmove="scrollTouchMove">
      <img
        alt="background"
        class="background-picker"
        :src="hud.backgroundPicker"
      />
      <div class="close-btn-anchor">
        <button class="close-btn" @click="hud.closeSpellPicker()" @touchend.prevent="hud.closeSpellPicker()">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <p class="title">Chọn chiêu thức</p>

      <p>
        Chế độ (mới):
        <span class="tooltip">
          <input type="checkbox" id="oneForAll" :checked="hud.oneForAll"
              @click="hud.oneForAll = !hud.oneForAll"
              @touchend.prevent="hud.oneForAll = !hud.oneForAll" />
          <label for="oneForAll">ONE spell for ALL</label>
          <span class="tooltiptext">Tất cả đều chỉ dùng 1 chiêu thức</span>
        </span>

        <span class="tooltip">
          <input type="checkbox" id="cloneMySpell" :checked="hud.cloneMySpell"
              @click="hud.cloneMySpell = !hud.cloneMySpell"
              @touchend.prevent="hud.cloneMySpell = !hud.cloneMySpell" />
          <label for="cloneMySpell">Clone my spells</label>
          <span class="tooltiptext">Tất cả đều dùng bộ chiêu thức giống bạn</span>
        </span>
      </p>

      <div class="list">
        <div
          class="group"
          v-for="group of hud.spellGroups"
          @mouseover="hud.mouseoverGroup(group)">
          <div class="group-header">
            <img v-if="group.image" :src="group.image" alt="spell" />
            <p>{{group.name}}</p>
          </div>
          <div v-for="spell of group.spells" class="spell"
            @click="hud.pick(spell)"
            @mouseover="hud.mouseover(spell, $event)"
            @mouseout="hud.mouseout(spell, $event)"
            @touchstart="hud.touchSpellStart(spell, $event)"
            @touchmove="hud.touchSpellMove($event)"
            @touchend.prevent="hud.touchSpellEnd(() => hud.pick(spell))"
            @touchcancel="hud.cancelLongPress()">
              <img :src="spell.image" alt="spell" />
          </div>
        </div>
      </div>

      <div class="change-logs">
        <p class="title">Lịch sử cập nhật</p>

        <p>
        2024-09-12:
          <ul>
            <li>MỚI: Graves W  - Bom mù</li>
            <li>MỚI: Cơ chế giảm tầm nhìn</li>
            <li>CẬP NHẬT: Teemo R nay có thể nảy</li>
            <li>CẬP NHẬT: Giảm thời gian đợi Q2 của yasuo - tích cộng dồn nhanh hơn</li>
            <li>Cập nhật hình ảnh các bộ chiêu thức</li>
          </ul>
        </p>
      </div>
  </div>
  `,
};
