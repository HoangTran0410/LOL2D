import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHANGELOG } from '../../src/scenes/about/changelog';
import { ARTICLES } from '../../src/scenes/about/articles';

/**
 * The About screen's two hand-edited data files, and the one safety rule its
 * template must obey.
 *
 * `CHANGELOG` and `ARTICLES` are the files a non-programmer edits directly —
 * see their own headers — so what is checked here is shape, not content: a
 * release needs a date, a title and at least one highlight; an article needs
 * a title, an `https://` url and a description. Nothing here pins specific
 * wording, or every retune of the copy would mean editing a test.
 *
 * The banned-jargon scan is the one exception, and is a real rule rather than
 * a style nit: CLAUDE.md is explicit that the changelog is "written in
 * Vietnamese, for players... 'bot biết đi lane và đẩy trụ' rather than
 * 'refactored TeamBlackboard'" — a class name leaking into player-facing copy
 * is exactly the kind of thing nobody notices in review and everybody notices
 * in the changelog.
 */
const SRC = join(__dirname, '../../src');

describe('CHANGELOG (about/changelog.ts)', () => {
  it('is not empty', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
  });

  it('every release has a date, a title and at least one highlight', () => {
    for (const release of CHANGELOG) {
      expect(release.date.trim().length, `release "${release.title}" has no date`).toBeGreaterThan(
        0
      );
      expect(release.title.trim().length, `a release has no title`).toBeGreaterThan(0);
      expect(
        release.highlights.length,
        `release "${release.title}" has no highlights`
      ).toBeGreaterThan(0);
      for (const highlight of release.highlights) {
        expect(
          highlight.trim().length,
          `release "${release.title}" has a blank highlight`
        ).toBeGreaterThan(0);
      }
    }
  });

  /** Internal names an agent reaching for accuracy would reach for first. */
  const BANNED_TERMS = [
    'TeamBlackboard',
    'BotBrain',
    'MatchDirector',
    'AIChampion',
    'ObjectManager',
    'PregameConfig',
    'refactor',
    'FSM',
    'signed distance field',
  ];

  it('reads like player-facing copy, not a commit log', () => {
    const offenders: string[] = [];
    for (const release of CHANGELOG) {
      const text = [release.title, ...release.highlights].join(' ');
      for (const term of BANNED_TERMS) {
        if (text.toLowerCase().includes(term.toLowerCase())) {
          offenders.push(`"${release.title}" mentions "${term}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the scan can see a violation it is meant to catch', () => {
    const sample = ['bots now query TeamBlackboard for lane state'];
    const offenders = sample.filter(text => text.toLowerCase().includes('teamblackboard'));
    expect(offenders).toHaveLength(1);
  });
});

describe('ARTICLES (about/articles.ts)', () => {
  it('every entry has a title, an https url and a description', () => {
    for (const article of ARTICLES) {
      expect(article.title.trim().length, 'an article has no title').toBeGreaterThan(0);
      expect(article.url.startsWith('https://'), `"${article.title}" url is not https`).toBe(true);
      expect(
        article.description.trim().length,
        `"${article.title}" has no description`
      ).toBeGreaterThan(0);
    }
  });
});

describe('AboutScene.vue link safety', () => {
  const source = readFileSync(join(SRC, 'scenes/AboutScene.vue'), 'utf8');

  /** Every `<a ...>` opening tag in the template, target-blank or not. */
  function anchorTags(html: string): string[] {
    return html.match(/<a\b[^>]*>/g) ?? [];
  }

  it('finds at least one external link to check', () => {
    const external = anchorTags(source).filter(tag => tag.includes('target="_blank"'));
    expect(external.length).toBeGreaterThan(0);
  });

  it('every target="_blank" anchor carries rel="noopener noreferrer"', () => {
    const offenders = anchorTags(source)
      .filter(tag => tag.includes('target="_blank"'))
      .filter(tag => !tag.includes('rel="noopener noreferrer"'));
    expect(offenders).toEqual([]);
  });

  it('the scan can see a violation it is meant to catch', () => {
    const sample = '<a href="https://example.com" target="_blank">example</a>';
    const offenders = anchorTags(sample)
      .filter(tag => tag.includes('target="_blank"'))
      .filter(tag => !tag.includes('rel="noopener noreferrer"'));
    expect(offenders).toHaveLength(1);
  });
});
