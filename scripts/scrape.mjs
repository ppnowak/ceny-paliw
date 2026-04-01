import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const PRICES_FILE = join(DATA_DIR, 'prices.json');
const PARSED_NEWS_FILE = join(DATA_DIR, 'parsed-news.json');
const SITE_DIR = join(__dirname, '..', 'site');

const NEWS_URL = 'https://www.gov.pl/web/energia/wiadomosci';
const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

/**
 * Fetch the news listing page and extract article links + snippets
 */
export async function fetchNewsPage(url = NEWS_URL) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch news page: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  return parseNewsListHtml(html);
}

/**
 * Parse the news listing HTML to extract article entries.
 * Each entry on gov.pl has a pattern like:
 *   <a href="/web/energia/slug">Title</a> and nearby date + snippet text
 */
export function parseNewsListHtml(html) {
  const articles = [];

  // Match article links with their titles - gov.pl uses specific patterns
  // Links are in format: /web/energia/article-slug
  const linkPattern = /href="(\/web\/energia\/[^"]+)"[^>]*>([^<]+)<\/a>/g;
  let match;

  while ((match = linkPattern.exec(html)) !== null) {
    const path = match[1];
    const title = match[2].trim();

    // Skip navigation / non-article links
    if (path === '/web/energia' ||
        path === '/web/energia/wiadomosci' ||
        path === '/web/energia/zapowiedzi' ||
        path === '/web/energia/aktualnosci' ||
        path.includes('?page=') ||
        path.includes('mapa-strony') ||
        path.includes('du-mp') ||
        title.length < 10) {
      continue;
    }

    const fullUrl = `https://www.gov.pl${path}`;

    // Only interested in fuel price announcements
    if (isFuelPriceArticle(title)) {
      articles.push({ url: fullUrl, title });
    }
  }

  // Deduplicate by URL
  const seen = new Set();
  return articles.filter(a => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
}

/**
 * Check if an article title suggests it contains fuel price data
 */
export function isFuelPriceArticle(title) {
  const lower = title.toLowerCase();
  return (
    (lower.includes('maksymaln') && lower.includes('cen') && lower.includes('paliw')) ||
    (lower.includes('cen') && lower.includes('detaliczn') && lower.includes('paliw'))
  );
}

/**
 * Fetch a single article page and extract the body text
 */
export async function fetchArticleContent(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch article ${url}: ${response.status}`);
  }
  const html = await response.text();
  return extractArticleText(html);
}

/**
 * Extract readable text from article HTML
 */
export function extractArticleText(html) {
  // Remove script and style tags
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  // Limit to a reasonable length for the AI
  return text.substring(0, 10000);
}

/**
 * Call NVidia AI API once to extract fuel prices from article text
 */
async function callAIOnce(prompt, apiKey) {
  const response = await fetch(NVIDIA_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      model: 'meta/llama-3.2-3b-instruct',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
      temperature: 0.05,
      top_p: 1.0,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`NVidia API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No content in NVidia API response');
  }

  return parseAIResponse(content);
}

/**
 * Pick the consensus result from multiple AI runs.
 * Groups results by (effectiveDate, pb95, pb98, on) rounded to 2 decimals,
 * then returns the group with the most votes.
 */
export function pickConsensus(results) {
  if (results.length === 0) return null;
  if (results.length === 1) return results[0];

  const groups = new Map();
  for (const r of results) {
    // Key by rounded prices + date to group near-identical answers
    const key = `${r.effectiveDate}|${r.pb95.toFixed(2)}|${r.pb98.toFixed(2)}|${r.on.toFixed(2)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  // Return the first result from the largest group
  let best = null;
  let bestCount = 0;
  for (const [, group] of groups) {
    if (group.length > bestCount) {
      bestCount = group.length;
      best = group[0];
    }
  }

  return best;
}

/**
 * Extract fuel prices with consensus voting — runs the prompt multiple times
 * and picks the most common answer to guard against model hallucinations.
 */
const CONSENSUS_RUNS = 3;

export async function extractPricesWithAI(articleText, article, apiKey) {
  if (!apiKey) {
    throw new Error('NVIDIA_API_KEY is required');
  }

  const prompt = `Analyze the article below and extract the prices of PB95, PB98, and ON fuels.

Article:
\`\`\`text
${article.title}

${articleText}
\`\`\`

Return only a JSON object strictly in the format below:
{
  "pb95": <number, i.e. 6.21>,
  "pb98": <number, i.e. 6.81>,
  "on": <number, i.e. 7.66>,
  "effectiveDate": "<effective date YYYY-MM-DD>",
  "publishedDate": "<published date YYYY-MM-DD>"
}

If you fail to find fuel prices, return: {"error": "no prices found"}`;

  const results = [];
  const errors = [];

  for (let run = 1; run <= CONSENSUS_RUNS; run++) {
    if (run > 1) await new Promise(r => setTimeout(r, 1500));

    try {
      const result = await callAIOnce(prompt, apiKey);
      if (result) {
        results.push(result);
        console.log(`  Run ${run}/${CONSENSUS_RUNS}: PB95=${result.pb95}, PB98=${result.pb98}, ON=${result.on}, date=${result.effectiveDate}`);
      } else {
        console.log(`  Run ${run}/${CONSENSUS_RUNS}: no prices found`);
      }
    } catch (err) {
      errors.push(err);
      console.log(`  Run ${run}/${CONSENSUS_RUNS}: error — ${err.message}`);
    }
  }

  if (results.length === 0) {
    if (errors.length > 0) throw errors[0];
    return null;
  }

  const consensus = pickConsensus(results);
  if (results.length > 1) {
    console.log(`  Consensus (${results.length} valid runs): PB95=${consensus.pb95}, PB98=${consensus.pb98}, ON=${consensus.on}`);
  }
  return consensus;
}

/**
 * Parse the AI response to extract JSON data
 */
export function parseAIResponse(content) {
  // Try to find JSON objects in the response — try each one
  const jsonMatches = content.match(/\{[^{}]*\}/g);
  if (!jsonMatches || jsonMatches.length === 0) {
    throw new Error(`Could not find JSON in AI response: ${content}`);
  }

  for (const jsonStr of jsonMatches) {
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      continue;
    }

    if (parsed.error) {
      return null;
    }

    // Validate the parsed data
    if (typeof parsed.pb95 === 'number' && typeof parsed.pb98 === 'number' && typeof parsed.on === 'number') {
      // Sanity check — fuel prices should be in a reasonable range (1-20 zł/l)
      const MIN_PRICE = 1.0;
      const MAX_PRICE = 20.0;
      if (parsed.pb95 < MIN_PRICE || parsed.pb95 > MAX_PRICE ||
          parsed.pb98 < MIN_PRICE || parsed.pb98 > MAX_PRICE ||
          parsed.on < MIN_PRICE || parsed.on > MAX_PRICE) {
        continue; // Skip unreasonable prices
      }

      // Validate date format (YYYY-MM-DD)
      if (parsed.effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(parsed.effectiveDate)) {
        continue;
      }

      return parsed;
    }
  }

  // If we found JSON but none valid, check if first one was an error
  const firstParsed = JSON.parse(jsonMatches[0]);
  if (firstParsed.error) return null;

  throw new Error(`Invalid price data in AI response: ${content}`);
}

/**
 * Load existing data files
 */
export async function loadData() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }

  let prices = [];
  let parsedNews = [];

  try {
    prices = JSON.parse(await readFile(PRICES_FILE, 'utf-8'));
  } catch {
    prices = [];
  }

  try {
    parsedNews = JSON.parse(await readFile(PARSED_NEWS_FILE, 'utf-8'));
  } catch {
    parsedNews = [];
  }

  return { prices, parsedNews };
}

/**
 * Save data files
 */
export async function saveData(prices, parsedNews) {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }

  // Sort prices by effectiveDate descending
  prices.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));

  await writeFile(PRICES_FILE, JSON.stringify(prices, null, 2), 'utf-8');
  await writeFile(PARSED_NEWS_FILE, JSON.stringify(parsedNews, null, 2), 'utf-8');
}

/**
 * Generate the site data file that the static site will consume
 */
export async function generateSiteData(prices) {
  if (!existsSync(SITE_DIR)) {
    await mkdir(SITE_DIR, { recursive: true });
  }

  const siteData = {
    lastUpdated: new Date().toISOString(),
    prices: prices.map(p => ({
      effectiveDate: p.effectiveDate,
      pb95: p.pb95,
      pb98: p.pb98,
      on: p.on,
      source: p.source || null,
    })),
  };

  await writeFile(
    join(SITE_DIR, 'data.json'),
    JSON.stringify(siteData, null, 2),
    'utf-8'
  );
}

/**
 * Main scraping pipeline
 */
export async function main() {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    console.error('Error: NVIDIA_API_KEY environment variable is required');
    process.exit(1);
  }

  console.log('Loading existing data...');
  const { prices, parsedNews } = await loadData();
  const parsedUrls = new Set(parsedNews.map(n => n.url));

  // Check if we already have prices for tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const hasTomorrow = prices.some(p => p.effectiveDate === tomorrowStr);

  if (hasTomorrow) {
    console.log(`Already have prices for tomorrow (${tomorrowStr}). Skipping scrape.`);
    // Still regenerate site data in case format changed
    await generateSiteData(prices);
    return;
  }

  console.log(`Found ${prices.length} existing prices, ${parsedNews.length} parsed news`);

  console.log('Fetching news page...');
  const articles = await fetchNewsPage();
  console.log(`Found ${articles.length} fuel price articles`);

  const newArticles = articles.filter(a => !parsedUrls.has(a.url));
  console.log(`${newArticles.length} new articles to process`);

  for (let i = 0; i < newArticles.length; i++) {
    const article = newArticles[i];

    // Delay between articles to avoid rate limiting
    if (i > 0) await new Promise(r => setTimeout(r, 2000));

    console.log(`\nProcessing: ${article.title}`);
    console.log(`URL: ${article.url}`);

    try {
      const text = await fetchArticleContent(article.url);
      console.log(`Article text length: ${text.length}`);

      const priceData = await extractPricesWithAI(text, article, apiKey);

      if (priceData) {
        console.log(`Extracted prices: PB95=${priceData.pb95}, PB98=${priceData.pb98}, ON=${priceData.on}`);
        console.log(`Effective date: ${priceData.effectiveDate}`);

        // Check for duplicate effective dates
        const existingForDate = prices.find(p => p.effectiveDate === priceData.effectiveDate);
        if (!existingForDate) {
          prices.push({
            date: priceData.publishedDate,
            effectiveDate: priceData.effectiveDate,
            pb95: priceData.pb95,
            pb98: priceData.pb98,
            on: priceData.on,
            source: article.url,
            publishedAt: priceData.publishedDate,
          });
        } else {
          console.log(`Skipping - already have prices for ${priceData.effectiveDate}`);
        }

        parsedNews.push({
          url: article.url,
          title: article.title,
          parsedAt: new Date().toISOString(),
          hasPrices: true,
        });
      } else {
        console.log('No prices found in article');
        parsedNews.push({
          url: article.url,
          title: article.title,
          parsedAt: new Date().toISOString(),
          hasPrices: false,
        });
      }
    } catch (error) {
      console.error(`Error processing article: ${error.message}`);
      parsedNews.push({
        url: article.url,
        title: article.title,
        parsedAt: new Date().toISOString(),
        hasPrices: false,
        error: error.message,
      });
    }
  }

  console.log('\nSaving data...');
  await saveData(prices, parsedNews);

  console.log('Generating site data...');
  await generateSiteData(prices);

  console.log('Done!');
}

// Run if executed directly
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` ||
    import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
