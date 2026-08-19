/**
 * "Bài viết" — write-ups and outside links about the project, shown on the
 * About screen (`AboutScene.vue`). Like `changelog.ts`, this is a file meant
 * to be edited directly.
 *
 * **To add one**: append an object with a `title`, an `url`, and a one-line
 * `description`. Nothing else needs to change — the About screen renders
 * whatever is here, and shows a plain "no articles yet" line when the array
 * is empty.
 *
 * No write-up URLs were supplied when this file was created, and a guessed
 * link is worse than none — a broken or wrong link erodes trust in every
 * other link on the screen. The two entries below are the ones that were
 * safe to add without a name being given: the project's own repository and
 * its README, both fetchable and both true. Add the first real write-up here
 * when one exists.
 */
export interface AboutArticle {
  title: string;
  url: string;
  description: string;
}

export const ARTICLES: AboutArticle[] = [
  {
    title: 'Giới thiệu Game - Build in Public',
    url: 'https://www.facebook.com/groups/indiehackervn/posts/2237444843709742/',
    description: 'Toàn bộ mã nguồn game — đọc, tải về, hoặc đóng góp thêm.',
  },
];
