import { describe, expect, it } from 'vitest';
import { validateSeoArticle } from './seoQualityGate';

describe('validateSeoArticle', () => {
  it('accepts a topical FAQ', () => {
    const html = '<h1>Кадастровая стоимость участка</h1><p>'.concat('Полезный текст о кадастровой стоимости участка и проверке данных. '.repeat(8), '</p>',
      '<details class="faq-item"><summary>Как проверить кадастровую стоимость участка?</summary><p>Проверьте адрес и кадастровый номер в выписке ЕГРН, затем сопоставьте сведения об объекте и дате обновления.</p></details>');
    expect(validateSeoArticle(html, 'кадастровая стоимость участка', 'Кадастровая стоимость участка').ok).toBe(true);
  });

  it('blocks the old invented service templates', () => {
    const html = '<h1>Кадастровая стоимость участка</h1><p>'.concat('Полезный текст о кадастровой стоимости участка. '.repeat(20), '</p>',
      '<details class="faq-item"><summary>Как проверить кадастровую стоимость участка?</summary><p>Срок действия сведений — до 30 дней. Гарантируем возврат средств.</p></details>');
    const report = validateSeoArticle(html, 'кадастровая стоимость участка');
    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('unsupported_service_claim');
  });
});

