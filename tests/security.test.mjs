import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAIResponse,
  extractArticleText,
  isFuelPriceArticle,
  parseNewsListHtml,
} from '../scripts/scrape.mjs';

describe('Security: XSS prevention in extractArticleText', () => {
  it('should strip script injection attempts', () => {
    const html = '<p>Price<script>document.cookie</script> is 6.21</p>';
    const text = extractArticleText(html);
    assert.ok(!text.includes('document.cookie'));
    assert.ok(!text.includes('<script'));
  });

  it('should strip event handler injection', () => {
    const html = '<div onload="alert(1)">Content</div>';
    const text = extractArticleText(html);
    assert.ok(!text.includes('onload'));
    assert.ok(!text.includes('alert'));
  });

  it('should handle deeply nested script tags', () => {
    const html = '<div><div><script>fetch("http://evil.com")</script></div></div><p>Safe</p>';
    const text = extractArticleText(html);
    assert.ok(!text.includes('evil.com'));
    assert.ok(text.includes('Safe'));
  });
});

describe('Security: Input validation in parseAIResponse', () => {
  it('should reject negative prices', () => {
    const response = '{"pb95": -1.0, "pb98": 6.81, "on": 7.66, "effectiveDate": "2026-04-01", "publishedDate": "2026-03-31"}';
    assert.throws(() => parseAIResponse(response), /Invalid price data/);
  });

  it('should reject extremely high prices', () => {
    const response = '{"pb95": 100.0, "pb98": 6.81, "on": 7.66, "effectiveDate": "2026-04-01", "publishedDate": "2026-03-31"}';
    assert.throws(() => parseAIResponse(response), /Invalid price data/);
  });

  it('should not pollute prototype via __proto__', () => {
    const response = '{"pb95": 6.21, "pb98": 6.81, "on": 7.66, "effectiveDate": "2026-04-01", "publishedDate": "2026-03-31", "__proto__": "admin"}';
    const result = parseAIResponse(response);
    assert.equal(result.pb95, 6.21);
    // Prototype should not be polluted
    assert.equal(({}).isAdmin, undefined);
  });
});

describe('Security: URL validation in parseNewsListHtml', () => {
  it('should not extract javascript: URLs', () => {
    const html = '<a href="javascript:alert(1)">Maksymalna cena detaliczna paliw test article</a>';
    const articles = parseNewsListHtml(html);
    assert.equal(articles.length, 0);
  });

  it('should not extract data: URLs', () => {
    const html = '<a href="data:text/html,<script>alert(1)</script>">Maksymalna cena detaliczna paliw</a>';
    const articles = parseNewsListHtml(html);
    assert.equal(articles.length, 0);
  });

  it('should only extract gov.pl article URLs', () => {
    const html = `
      <a href="/web/energia/cena-detaliczna-paliw-test">Maksymalna cena detaliczna paliw dziś</a>
      <a href="https://evil.com/web/energia/cena-paliw">Maksymalna cena detaliczna paliw fake</a>
    `;
    const articles = parseNewsListHtml(html);
    assert.equal(articles.length, 1);
    assert.ok(articles[0].url.startsWith('https://www.gov.pl'));
  });
});

describe('Security: isFuelPriceArticle edge cases', () => {
  it('should handle very short titles', () => {
    assert.ok(!isFuelPriceArticle('ab'));
    assert.ok(!isFuelPriceArticle(''));
  });

  it('should handle very long strings', () => {
    const longTitle = 'A'.repeat(10000) + 'maksymalna cena detaliczna paliw';
    // Should not hang or crash
    const result = isFuelPriceArticle(longTitle);
    assert.ok(result);
  });
});
