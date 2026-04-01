/* global Chart */

(function () {
  'use strict';

  const DATA_URL = 'data.json';
  const THEME_KEY = 'ceny-paliw-theme';
  const VISIBLE_CARDS_DESKTOP = 3;

  let priceData = null;
  let allEntries = []; // all price entries sorted ascending
  let currentIndex = 0; // index of center card in allEntries
  let chartInstance = null;

  // --- Utilities ---

  function formatDateShort(dateStr) {
    const parts = dateStr.split('-');
    return `${parts[2]}.${parts[1]}`;
  }

  function formatDateFull(dateStr) {
    const parts = dateStr.split('-');
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }

  function getDayLabel(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const date = new Date(dateStr + 'T00:00:00');
    date.setHours(0, 0, 0, 0);
    const diffDays = Math.round((date - today) / 86400000);
    const formatted = formatDateFull(dateStr);
    if (diffDays === 0) return `Dzisiaj — ${formatted}`;
    if (diffDays === -1) return `Wczoraj — ${formatted}`;
    if (diffDays === 1) return `Jutro — ${formatted}`;
    return formatted;
  }

  function getTomorrowStr() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }

  function getTodayStr() {
    return new Date().toISOString().split('T')[0];
  }

  function isMobile() {
    return window.innerWidth <= 600;
  }

  // --- Build entries with "unknown tomorrow" ---

  function buildEntries(prices) {
    if (!prices || prices.length === 0) return [];

    const sorted = [...prices].sort((a, b) =>
      a.effectiveDate.localeCompare(b.effectiveDate)
    );

    const tomorrowStr = getTomorrowStr();
    const hasTomorrow = sorted.some(p => p.effectiveDate === tomorrowStr);

    if (!hasTomorrow) {
      sorted.push({
        effectiveDate: tomorrowStr,
        pb95: null,
        pb98: null,
        on: null,
        unknown: true,
      });
    }

    return sorted;
  }

  function findBestStartIndex(entries) {
    const todayStr = getTodayStr();
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < entries.length; i++) {
      const d = new Date(entries[i].effectiveDate + 'T00:00:00');
      const today = new Date(todayStr + 'T00:00:00');
      const diff = Math.abs(d - today);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  // --- Price change ---

  function getPriceChange(current, previous, key) {
    if (!previous || current[key] === null || previous[key] === null) return null;
    const diff = current[key] - previous[key];
    if (Math.abs(diff) < 0.005) return { direction: 'same', value: 0 };
    return {
      direction: diff > 0 ? 'up' : 'down',
      value: Math.abs(diff),
    };
  }

  // --- Render functions ---

  function renderPriceRow(label, cssClass, price, change) {
    let changeHtml = '';
    if (change && change.direction !== 'same') {
      const arrow = change.direction === 'up' ? '↑' : '↓';
      changeHtml = `<span class="price-change price-change--${change.direction}">${arrow}${change.value.toFixed(2)}</span>`;
    }

    return `
      <div class="price-row">
        <span class="price-label ${cssClass}">${label}</span>
        <span>
          <span class="price-value">${price.toFixed(2)}</span>
          <span class="price-unit">zł/l</span>
          ${changeHtml}
        </span>
      </div>
    `;
  }

  function renderCard(entry, isActive, previousEntry) {
    const label = getDayLabel(entry.effectiveDate);

    if (entry.unknown) {
      const activeClass = isActive ? 'price-card--active' : 'price-card--inactive';
      return `
        <div class="price-card price-card--unknown ${activeClass}" data-date="${entry.effectiveDate}">
          <div class="price-card__date">${label}</div>
          <div class="price-card__unknown">
            <span class="price-card__unknown-icon">?</span>
            <span>Brak danych</span>
          </div>
        </div>
      `;
    }

    const activeClass = isActive ? 'price-card--active' : 'price-card--inactive';

    const pb95Change = getPriceChange(entry, previousEntry, 'pb95');
    const pb98Change = getPriceChange(entry, previousEntry, 'pb98');
    const onChange = getPriceChange(entry, previousEntry, 'on');

    const sourceLink = entry.source
      ? `<div class="price-card__source"><a href="${entry.source}" target="_blank" rel="noopener noreferrer">źródło ↗</a></div>`
      : '';

    return `
      <div class="price-card ${activeClass}" data-date="${entry.effectiveDate}">
        <div class="price-card__date">${label}</div>
        ${renderPriceRow('PB95', 'price-label--pb95', entry.pb95, pb95Change)}
        ${renderPriceRow('PB98', 'price-label--pb98', entry.pb98, pb98Change)}
        ${renderPriceRow('ON', 'price-label--on', entry.on, onChange)}
        ${sourceLink}
      </div>
    `;
  }

  function getVisibleWindow() {
    const count = isMobile() ? 1 : Math.min(VISIBLE_CARDS_DESKTOP, allEntries.length);
    const half = Math.floor(count / 2);

    let start = currentIndex - half;
    let end = start + count;

    if (start < 0) {
      start = 0;
      end = Math.min(count, allEntries.length);
    }
    if (end > allEntries.length) {
      end = allEntries.length;
      start = Math.max(0, end - count);
    }

    return { start, end };
  }

  function renderCarousel() {
    const track = document.getElementById('carouselTrack');

    if (allEntries.length === 0) {
      track.innerHTML = '<p class="no-data">Brak danych o cenach paliw</p>';
      updateNavButtons();
      return;
    }

    const { start, end } = getVisibleWindow();
    const visibleEntries = allEntries.slice(start, end);

    track.innerHTML = visibleEntries.map((entry, i) => {
      const globalIdx = start + i;
      const isActive = globalIdx === currentIndex;
      const prevEntry = globalIdx > 0 ? allEntries[globalIdx - 1] : null;
      return renderCard(entry, isActive, prevEntry);
    }).join('');

    // Click handlers for inactive cards
    document.querySelectorAll('.price-card--inactive').forEach(card => {
      card.addEventListener('click', () => {
        const idx = allEntries.findIndex(e => e.effectiveDate === card.dataset.date);
        if (idx >= 0) {
          currentIndex = idx;
          renderCarousel();
        }
      });
    });

    updateNavButtons();
  }

  function updateNavButtons() {
    document.getElementById('prevDay').disabled = currentIndex <= 0;
    document.getElementById('nextDay').disabled = currentIndex >= allEntries.length - 1;
  }

  // --- Chart (modal) ---

  function openChartModal() {
    const modal = document.getElementById('chartModal');
    modal.hidden = false;
    renderChart();
    document.body.style.overflow = 'hidden';
  }

  function closeChartModal() {
    const modal = document.getElementById('chartModal');
    modal.hidden = true;
    document.body.style.overflow = '';
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  }

  function renderChart() {
    if (!priceData || priceData.prices.length === 0) return;

    const sorted = [...priceData.prices].sort((a, b) =>
      a.effectiveDate.localeCompare(b.effectiveDate)
    );

    const labels = sorted.map(p => formatDateFull(p.effectiveDate));
    const pb95Data = sorted.map(p => p.pb95);
    const pb98Data = sorted.map(p => p.pb98);
    const onData = sorted.map(p => p.on);

    const ctx = document.getElementById('priceChart').getContext('2d');

    if (chartInstance) chartInstance.destroy();

    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#94a3b8';
    const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || 'rgba(51,65,85,0.5)';

    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'PB95',
            data: pb95Data,
            borderColor: getComputedStyle(document.documentElement).getPropertyValue('--pb95').trim(),
            backgroundColor: 'rgba(34,197,94,0.1)',
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 7,
          },
          {
            label: 'PB98',
            data: pb98Data,
            borderColor: getComputedStyle(document.documentElement).getPropertyValue('--pb98').trim(),
            backgroundColor: 'rgba(59,130,246,0.1)',
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 7,
          },
          {
            label: 'ON',
            data: onData,
            borderColor: getComputedStyle(document.documentElement).getPropertyValue('--on').trim(),
            backgroundColor: 'rgba(245,158,11,0.1)',
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 7,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            labels: { color: textColor, font: { size: 13 } },
          },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(15,23,42,0.95)',
            titleColor: '#f1f5f9',
            bodyColor: '#f1f5f9',
            borderColor: 'rgba(56,189,248,0.3)',
            borderWidth: 1,
            padding: 12,
            displayColors: true,
            callbacks: {
              title: (items) => items[0]?.label || '',
              label: (context) => ` ${context.dataset.label}: ${context.parsed.y.toFixed(2)} zł/l`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: textColor },
            grid: { color: gridColor },
          },
          y: {
            ticks: {
              color: textColor,
              callback: (value) => `${value.toFixed(2)} zł`,
            },
            grid: { color: gridColor },
          },
        },
      },
    });
  }

  // --- Footer: last updated + staleness dot ---

  function renderFooter(lastUpdated) {
    if (!lastUpdated) return;

    const date = new Date(lastUpdated);
    const opts = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };
    document.getElementById('lastUpdated').textContent =
      `Aktualizacja: ${date.toLocaleDateString('pl-PL', opts)}`;

    const dot = document.getElementById('stalenessDot');
    const hoursAgo = (Date.now() - date.getTime()) / 3600000;

    let level, title;
    if (hoursAgo < 24) {
      level = 'fresh';
      title = 'Dane aktualne';
    } else if (hoursAgo < 72) {
      level = 'stale';
      title = `Dane sprzed ${Math.floor(hoursAgo / 24)} dni`;
    } else {
      level = 'old';
      title = `Dane sprzed ${Math.floor(hoursAgo / 24)} dni`;
    }

    dot.className = `staleness-dot staleness-dot--${level}`;
    dot.title = title;
  }

  // --- Theme ---

  function getTheme() {
    return localStorage.getItem(THEME_KEY) || 'auto';
  }

  function setTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
    document.body.setAttribute('data-theme', theme);
  }

  function cycleTheme() {
    const order = ['auto', 'dark', 'light'];
    const current = getTheme();
    const next = order[(order.indexOf(current) + 1) % order.length];
    setTheme(next);
  }

  // --- Touch swipe ---

  function setupTouchSwipe(element) {
    let touchStartX = 0;
    const MIN_SWIPE = 50;

    element.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    element.addEventListener('touchend', (e) => {
      const diff = touchStartX - e.changedTouches[0].screenX;
      if (Math.abs(diff) > MIN_SWIPE) {
        if (diff > 0 && currentIndex < allEntries.length - 1) {
          currentIndex++;
          renderCarousel();
        } else if (diff < 0 && currentIndex > 0) {
          currentIndex--;
          renderCarousel();
        }
      }
    }, { passive: true });
  }

  // --- Skeleton ---

  function renderSkeleton() {
    const track = document.getElementById('carouselTrack');
    const count = isMobile() ? 1 : 3;
    track.innerHTML = '<div class="skeleton skeleton-card"></div>'.repeat(count);
  }

  // --- Init ---

  async function init() {
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error');

    // Apply saved theme
    setTheme(getTheme());

    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', cycleTheme);

    renderSkeleton();

    try {
      const response = await fetch(DATA_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      priceData = await response.json();

      allEntries = buildEntries(priceData.prices);
      currentIndex = findBestStartIndex(allEntries);

      renderCarousel();
      renderFooter(priceData.lastUpdated);

      // Chart modal
      document.getElementById('chartToggle').addEventListener('click', openChartModal);
      document.getElementById('chartModalClose').addEventListener('click', closeChartModal);
      document.getElementById('chartModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeChartModal();
      });

      // Nav buttons
      document.getElementById('prevDay').addEventListener('click', () => {
        if (currentIndex > 0) { currentIndex--; renderCarousel(); }
      });
      document.getElementById('nextDay').addEventListener('click', () => {
        if (currentIndex < allEntries.length - 1) { currentIndex++; renderCarousel(); }
      });

      // Keyboard
      document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' && currentIndex > 0) { currentIndex--; renderCarousel(); }
        else if (e.key === 'ArrowRight' && currentIndex < allEntries.length - 1) { currentIndex++; renderCarousel(); }
        else if (e.key === 'Escape') closeChartModal();
      });

      // Touch swipe
      setupTouchSwipe(document.getElementById('carouselTrack'));

      // Responsive re-render on resize
      let resizeTimer;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => renderCarousel(), 150);
      });

      // Hide loading
      loadingEl.classList.add('hidden');
      setTimeout(() => { loadingEl.style.display = 'none'; }, 300);

    } catch (error) {
      console.error('Failed to load price data:', error);
      loadingEl.style.display = 'none';
      errorEl.hidden = false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // PWA service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
