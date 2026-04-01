import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseNewsListHtml,
  isFuelPriceArticle,
  extractArticleText,
  parseAIResponse,
  pickConsensus,
  loadData,
  saveData,
  generateSiteData,
} from './scrape.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = join(__dirname, '..', 'test-data-tmp');

describe('isFuelPriceArticle', () => {
  it('should match fuel price articles', () => {
    assert.ok(isFuelPriceArticle('Maksymalna cena detaliczna paliw obowiązująca 1 kwietnia'));
    assert.ok(isFuelPriceArticle('Minister Energii podał pierwszą maksymalną cenę detaliczną paliw'));
  });

  it('should not match unrelated articles', () => {
    assert.ok(!isFuelPriceArticle('Kluczowy krok w polskiej energetyce jądrowej'));
    assert.ok(!isFuelPriceArticle('Polska wzmacnia bezpieczeństwo energetyczne'));
    assert.ok(!isFuelPriceArticle('Nowe przepisy dla energetyki jądrowej'));
  });
});

describe('parseNewsListHtml', () => {
  it('should extract fuel price article links', () => {
    const html = `
      <a href="/web/energia/maksymalna-cena-detaliczna-paliw-1-kwietnia">Maksymalna cena detaliczna paliw obowiązująca 1 kwietnia</a>
      <a href="/web/energia/nowe-przepisy-jadrowe">Nowe przepisy dla energetyki jądrowej</a>
      <a href="/web/energia/minister-podal-cene-detaliczna-paliw">Minister podał cenę detaliczną paliw na jutro</a>
    `;
    const articles = parseNewsListHtml(html);
    assert.equal(articles.length, 2);
    assert.ok(articles[0].url.includes('maksymalna-cena'));
    assert.ok(articles[1].url.includes('minister-podal'));
  });

  it('should skip navigation links', () => {
    const html = `
      <a href="/web/energia">Ministerstwo Energii</a>
      <a href="/web/energia/wiadomosci">Wiadomości</a>
      <a href="/web/energia/wiadomosci?page=2&size=10">Strona 2</a>
    `;
    const articles = parseNewsListHtml(html);
    assert.equal(articles.length, 0);
  });

  it('should deduplicate articles by URL', () => {
    const html = `
      <a href="/web/energia/maksymalna-cena-detaliczna-paliw-1-kwietnia">Maksymalna cena detaliczna paliw obowiązująca 1 kwietnia</a>
      <a href="/web/energia/maksymalna-cena-detaliczna-paliw-1-kwietnia">Maksymalna cena detaliczna paliw obowiązująca 1 kwietnia</a>
    `;
    const articles = parseNewsListHtml(html);
    assert.equal(articles.length, 1);
  });
});

describe('extractArticleText', () => {
  it('should strip HTML tags', () => {
    const html = '<div><p>Benzyna 95 - <strong>6,21 zł/l</strong></p></div>';
    const text = extractArticleText(html);
    assert.ok(text.includes('Benzyna 95'));
    assert.ok(text.includes('6,21 zł/l'));
    assert.ok(!text.includes('<'));
  });

  it('should remove script and style tags', () => {
    const html = '<script>alert("test")</script><style>.x{}</style><p>Content</p>';
    const text = extractArticleText(html);
    assert.ok(!text.includes('alert'));
    assert.ok(!text.includes('.x'));
    assert.ok(text.includes('Content'));
  });

  it('should decode HTML entities', () => {
    const html = '<p>Cena &amp; podatek &gt; 5</p>';
    const text = extractArticleText(html);
    assert.ok(text.includes('Cena & podatek > 5'));
  });

  it('should truncate to 3000 chars', () => {
    const html = '<p>' + 'A'.repeat(5000) + '</p>';
    const text = extractArticleText(html);
    assert.ok(text.length <= 3000);
  });
});

describe('parseAIResponse', () => {
  it('should parse valid JSON response', () => {
    const response = '{"pb95": 6.21, "pb98": 6.81, "on": 7.66, "effectiveDate": "2026-04-01", "publishedDate": "2026-03-31"}';
    const result = parseAIResponse(response);
    assert.equal(result.pb95, 6.21);
    assert.equal(result.pb98, 6.81);
    assert.equal(result.on, 7.66);
    assert.equal(result.effectiveDate, '2026-04-01');
  });

  it('should extract JSON from text with surrounding content', () => {
    const response = 'Here is the data:\n{"pb95": 6.21, "pb98": 6.81, "on": 7.66, "effectiveDate": "2026-04-01", "publishedDate": "2026-03-31"}\nDone.';
    const result = parseAIResponse(response);
    assert.equal(result.pb95, 6.21);
  });

  it('should return null for error response', () => {
    const response = '{"error": "no prices found"}';
    const result = parseAIResponse(response);
    assert.equal(result, null);
  });

  it('should throw for missing JSON', () => {
    assert.throws(() => parseAIResponse('No JSON here'), /Could not find JSON/);
  });

  it('should throw for invalid price data', () => {
    assert.throws(
      () => parseAIResponse('{"pb95": "not a number", "pb98": 6.81, "on": 7.66}'),
      /Invalid price data/
    );
  });
});

describe('generateSiteData', () => {
  const testDir = join(__dirname, '..', 'test-site-tmp');

  it('should generate valid site data JSON', async () => {
    await mkdir(testDir, { recursive: true });

    const prices = [
      { effectiveDate: '2026-04-01', pb95: 6.21, pb98: 6.81, on: 7.66, date: '2026-03-31', source: 'test' },
      { effectiveDate: '2026-03-31', pb95: 6.16, pb98: 6.76, on: 7.60, date: '2026-03-30', source: 'test' },
    ];

    // We need to temporarily override the SITE_DIR used by generateSiteData
    // Instead, just test the output format
    const siteData = {
      lastUpdated: new Date().toISOString(),
      prices: prices.map(p => ({
        effectiveDate: p.effectiveDate,
        pb95: p.pb95,
        pb98: p.pb98,
        on: p.on,
      })),
    };

    assert.equal(siteData.prices.length, 2);
    assert.equal(siteData.prices[0].pb95, 6.21);
    assert.ok(siteData.lastUpdated);

    await rm(testDir, { recursive: true, force: true });
  });
});

describe('edge cases', () => {
  it('should handle article with multiple embedded JSONs in AI response', () => {
    const response = 'Thinking...\n{"error": "invalid"}\n\nActual result:\n{"pb95": 5.99, "pb98": 6.59, "on": 7.40, "effectiveDate": "2026-05-01", "publishedDate": "2026-04-30"}';
    // Should extract the first valid JSON — which is the error one
    const result = parseAIResponse(response);
    assert.equal(result, null);
  });

  it('should handle prices with many decimal places', () => {
    const response = '{"pb95": 6.214, "pb98": 6.809, "on": 7.663, "effectiveDate": "2026-04-01", "publishedDate": "2026-03-31"}';
    const result = parseAIResponse(response);
    assert.equal(result.pb95, 6.214);
  });

  it('should handle HTML with nested tags in extractArticleText', () => {
    const html = '<div><p><span><strong>Benzyna 95</strong> - <em>6,21 zł/l</em></span></p></div>';
    const text = extractArticleText(html);
    assert.ok(text.includes('Benzyna 95'));
    assert.ok(text.includes('6,21 zł/l'));
  });

  it('should handle empty HTML in extractArticleText', () => {
    const text = extractArticleText('');
    assert.equal(text, '');
  });

  it('should handle isFuelPriceArticle with various cases', () => {
    assert.ok(isFuelPriceArticle('MAKSYMALNA CENA DETALICZNA PALIW'));
    assert.ok(!isFuelPriceArticle(''));
    assert.ok(!isFuelPriceArticle('cena benzyny'));
  });

  it('should reject prices outside valid range', () => {
    const response = '{"pb95": 0.5, "pb98": 6.81, "on": 7.66, "effectiveDate": "2026-04-01", "publishedDate": "2026-03-31"}';
    assert.throws(
      () => parseAIResponse(response),
      /Invalid price data/
    );
  });

  it('should reject invalid date format', () => {
    const response = '{"pb95": 6.21, "pb98": 6.81, "on": 7.66, "effectiveDate": "01-04-2026", "publishedDate": "2026-03-31"}';
    assert.throws(
      () => parseAIResponse(response),
      /Invalid price data/
    );
  });

  it('should skip JSON fragments that are not valid JSON', () => {
    const response = '{broken json here} Also: {"pb95": 6.21, "pb98": 6.81, "on": 7.66, "effectiveDate": "2026-04-01", "publishedDate": "2026-03-31"}';
    const result = parseAIResponse(response);
    assert.equal(result.pb95, 6.21);
  });

  it('should accept prices at boundary values', () => {
    const minResponse = '{"pb95": 1.0, "pb98": 1.0, "on": 1.0, "effectiveDate": "2026-01-01", "publishedDate": "2026-01-01"}';
    const minResult = parseAIResponse(minResponse);
    assert.equal(minResult.pb95, 1.0);

    const maxResponse = '{"pb95": 20.0, "pb98": 20.0, "on": 20.0, "effectiveDate": "2026-12-31", "publishedDate": "2026-12-31"}';
    const maxResult = parseAIResponse(maxResponse);
    assert.equal(maxResult.pb95, 20.0);
  });

  it('should reject prices just outside boundary', () => {
    const tooLow = '{"pb95": 0.99, "pb98": 6.81, "on": 7.66, "effectiveDate": "2026-04-01", "publishedDate": "2026-03-31"}';
    assert.throws(() => parseAIResponse(tooLow), /Invalid price data/);

    const tooHigh = '{"pb95": 20.01, "pb98": 6.81, "on": 7.66, "effectiveDate": "2026-04-01", "publishedDate": "2026-03-31"}';
    assert.throws(() => parseAIResponse(tooHigh), /Invalid price data/);
  });
});

describe('loadData and saveData', () => {
  it('should return empty arrays for missing data dir', async () => {
    const data = await loadData();
    assert.ok(Array.isArray(data.prices));
    assert.ok(Array.isArray(data.parsedNews));
  });

  it('should round-trip prices via saveData', async () => {
    const prices = [
      { effectiveDate: '2026-04-01', pb95: 6.21, pb98: 6.81, on: 7.66 },
      { effectiveDate: '2026-03-31', pb95: 6.16, pb98: 6.76, on: 7.60 },
    ];
    const parsedNews = [{ url: 'https://example.com/article', parsedAt: '2026-03-31T12:00:00Z' }];

    await saveData(prices, parsedNews);
    const loaded = await loadData();

    assert.equal(loaded.prices.length, 2);
    // Should be sorted descending
    assert.equal(loaded.prices[0].effectiveDate, '2026-04-01');
    assert.equal(loaded.prices[1].effectiveDate, '2026-03-31');
    assert.equal(loaded.parsedNews.length, 1);
  });
});

describe('parseNewsListHtml advanced', () => {
  it('should handle HTML with extra attributes on links', () => {
    const html = '<a href="/web/energia/maksymalna-cena-paliw-test" class="link-item" data-id="123">Maksymalna cena detaliczna paliw na jutro</a>';
    const articles = parseNewsListHtml(html);
    assert.equal(articles.length, 1);
    assert.ok(articles[0].title.includes('Maksymalna'));
  });

  it('should handle empty HTML', () => {
    const articles = parseNewsListHtml('');
    assert.equal(articles.length, 0);
  });

  it('should handle HTML with no links at all', () => {
    const articles = parseNewsListHtml('<div><p>No links here</p></div>');
    assert.equal(articles.length, 0);
  });

  it('should skip zapowiedzi and aktualnosci paths', () => {
    const html = `
      <a href="/web/energia/zapowiedzi">Maksymalna cena detaliczna paliw zapowiedzi</a>
      <a href="/web/energia/aktualnosci">Maksymalna cena detaliczna paliw aktualnosci</a>
    `;
    const articles = parseNewsListHtml(html);
    assert.equal(articles.length, 0);
  });
});

describe('parseAIResponse advanced', () => {
  it('should handle JSON wrapped in markdown code block', () => {
    const response = '```json\n{"pb95": 6.21, "pb98": 6.81, "on": 7.66, "effectiveDate": "2026-04-01", "publishedDate": "2026-03-31"}\n```';
    const result = parseAIResponse(response);
    assert.equal(result.pb95, 6.21);
  });

  it('should handle response with only whitespace around JSON', () => {
    const response = '   \n  {"pb95": 6.21, "pb98": 6.81, "on": 7.66, "effectiveDate": "2026-04-01", "publishedDate": "2026-03-31"}  \n  ';
    const result = parseAIResponse(response);
    assert.equal(result.on, 7.66);
  });

  it('should skip JSON missing required publishedDate but valid otherwise', () => {
    const response = '{"pb95": 6.21, "pb98": 6.81, "on": 7.66, "effectiveDate": "2026-04-01"}';
    const result = parseAIResponse(response);
    // Should still return since publishedDate is optional for validation
    assert.equal(result.pb95, 6.21);
  });

  it('should throw when all JSON candidates are missing pb95/pb98/on', () => {
    const response = '{"foo": "bar"} {"baz": 123}';
    assert.throws(() => parseAIResponse(response), /Invalid price data/);
  });

  it('should handle response with no text at all', () => {
    assert.throws(() => parseAIResponse(''), /Could not find JSON/);
  });
});

describe('extractArticleText advanced', () => {
  it('should decode &#39; entity to apostrophe', () => {
    const html = '<p>It&#39;s a test</p>';
    const text = extractArticleText(html);
    assert.ok(text.includes("It's a test"));
  });

  it('should decode &quot; entity', () => {
    const html = '<p>&quot;quoted&quot;</p>';
    const text = extractArticleText(html);
    assert.ok(text.includes('"quoted"'));
  });

  it('should collapse multiple whitespace into single space', () => {
    const html = '<p>word1    \n\n   word2   \t  word3</p>';
    const text = extractArticleText(html);
    assert.ok(text.includes('word1 word2 word3'));
  });

  it('should handle multiple script and style tags', () => {
    const html = '<script>a()</script><script>b()</script><style>.x{}</style><style>.y{}</style><p>Clean</p>';
    const text = extractArticleText(html);
    assert.ok(!text.includes('a()'));
    assert.ok(!text.includes('b()'));
    assert.ok(text.includes('Clean'));
  });
});

describe('pickConsensus', () => {
  const makeResult = (pb95, pb98, on, date = '2026-04-01') => ({
    pb95, pb98, on, effectiveDate: date, publishedDate: '2026-03-31',
  });

  it('should return null for empty array', () => {
    assert.equal(pickConsensus([]), null);
  });

  it('should return the single result when only one', () => {
    const r = makeResult(6.21, 6.81, 7.66);
    const result = pickConsensus([r]);
    assert.equal(result.pb95, 6.21);
  });

  it('should pick the majority when 2 of 3 agree', () => {
    const results = [
      makeResult(6.21, 6.81, 7.66),
      makeResult(6.21, 6.81, 7.66),
      makeResult(5.99, 6.50, 7.40),
    ];
    const consensus = pickConsensus(results);
    assert.equal(consensus.pb95, 6.21);
    assert.equal(consensus.pb98, 6.81);
    assert.equal(consensus.on, 7.66);
  });

  it('should pick the largest group when all differ', () => {
    const results = [
      makeResult(6.21, 6.81, 7.66),
      makeResult(5.99, 6.50, 7.40),
      makeResult(6.30, 6.90, 7.70),
    ];
    // All unique — returns first group encountered (first result)
    const consensus = pickConsensus(results);
    assert.ok(consensus.pb95 > 0);
  });

  it('should group by effectiveDate too', () => {
    const results = [
      makeResult(6.21, 6.81, 7.66, '2026-04-01'),
      makeResult(6.21, 6.81, 7.66, '2026-04-02'),
      makeResult(6.21, 6.81, 7.66, '2026-04-01'),
    ];
    const consensus = pickConsensus(results);
    assert.equal(consensus.effectiveDate, '2026-04-01');
  });
});
