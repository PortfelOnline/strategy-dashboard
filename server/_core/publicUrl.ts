// Публичный адрес сайта для ссылок, которые увидит читатель (CTA в статьях, перелинковка).
//
// 🚨 siteUrl WP-аккаунта указывает на origin (http://167.86.116.15:8082): запись в WP через
// публичный хост рвётся транзитом n → proxy4 → туннель → n. Но в текст статьи такой адрес
// попадать не должен — это http-ссылка на неканонический хост прямо в теле страницы.
// 02.08.2026 так набралось 32 статьи с кнопкой «Заказать документ» на IP:8082.
export function publicSiteBase(siteUrl: string): string {
  const pub = process.env.PUBLIC_SITE_URL;
  if (pub) return pub.replace(/\/$/, '');
  try {
    const u = new URL(siteUrl);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || u.port) return 'https://100zem.ru';
  } catch { /* не URL — вернём как есть */ }
  return siteUrl.replace(/\/$/, '');
}
