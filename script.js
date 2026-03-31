/**
 * WandrAI — script.js
 * Frontend logic: form handling, AJAX calls, UI rendering, history
 * ============================================================
 */

/* ─────────────────────────────────────────────────────────────
   DOM REFERENCES
───────────────────────────────────────────────────────────── */
const plannerForm       = document.getElementById('plannerForm');
const generateBtn       = document.getElementById('generateBtn');
const btnText           = generateBtn.querySelector('.btn-text');
const btnLoading        = generateBtn.querySelector('.btn-loading');

const resultSection     = document.getElementById('result-section');
const itineraryGrid     = document.getElementById('itineraryGrid');
const tripSummaryBanner = document.getElementById('tripSummaryBanner');
const saveTripBtn       = document.getElementById('saveTripBtn');
const destInfoCard      = document.getElementById('destInfoCard');

const historyLoading    = document.getElementById('historyLoading');
const historyEmpty      = document.getElementById('historyEmpty');
const tripsGrid         = document.getElementById('tripsGrid');

const toastContainer    = document.getElementById('toastContainer');
const tripDetailModal   = document.getElementById('tripDetailModal');
const modalClose        = document.getElementById('modalClose');

/* ─────────────────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────────────────── */
let currentTripData = null; // Holds the last generated trip for saving

/* ─────────────────────────────────────────────────────────────
   TRAVEL STYLE CHIP SELECTION
───────────────────────────────────────────────────────────── */
document.querySelectorAll('#travelStyleChips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    // Remove active from all, apply to clicked
    document.querySelectorAll('#travelStyleChips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    document.getElementById('travelStyle').value = chip.dataset.value;
  });
});

/* ─────────────────────────────────────────────────────────────
   FORM SUBMIT — Generate Itinerary
───────────────────────────────────────────────────────────── */
plannerForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  // ── Grab & Validate inputs ──
  const destination  = document.getElementById('destination').value.trim();
  const days         = parseInt(document.getElementById('days').value);
  const budget       = parseFloat(document.getElementById('budget').value);
  const travelStyle  = document.getElementById('travelStyle').value;

  if (!destination) { showToast('Please enter a destination.', 'error'); return; }
  if (!days || days < 1 || days > 30) { showToast('Days must be between 1 and 30.', 'error'); return; }
  if (!budget || budget < 100) { showToast('Budget must be at least $100.', 'error'); return; }

  // ── Show loading state ──
  setLoadingState(true);
  resultSection.style.display = 'none';
  currentTripData = null;

  try {
    // ── AJAX POST to process.php ──
    const response = await fetch('process.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:      'generate',
        destination,
        days,
        budget,
        travelStyle
      })
    });

    // Check HTTP-level error
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}. Make sure your PHP server is running.`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to generate itinerary. Please try again.');
    }

    // ── Render result ──
    renderResult(data, { destination, days, budget, travelStyle });

    // Store for potential save
    currentTripData = { ...data, destination, days, budget, travelStyle };

    // Scroll to result
    setTimeout(() => {
      resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);

  } catch (err) {
    console.error('Generate error:', err);
    showToast(err.message, 'error');
  } finally {
    setLoadingState(false);
  }
});

/* ─────────────────────────────────────────────────────────────
   RENDER RESULT
───────────────────────────────────────────────────────────── */
function renderResult(data, inputs) {
  const { destination, days, budget, travelStyle } = inputs;

  // ── Trip Summary Banner ──
  document.getElementById('tripDestDisplay').textContent  = destination;
  document.getElementById('tripDaysDisplay').textContent  = days;
  document.getElementById('tripBudgetDisplay').textContent = budget.toLocaleString();
  document.getElementById('tripStyleDisplay').textContent = travelStyle;

  // Reset save button
  saveTripBtn.disabled = false;
  saveTripBtn.innerHTML = '<i class="ri-bookmark-line"></i> Save Trip';

  // ── Destination Info from DB ──
  if (data.destInfo) {
    const di = data.destInfo;
    document.getElementById('destInfoName').textContent = di.country;
    document.getElementById('destInfoDesc').textContent = di.description;
    document.getElementById('destInfoCost').textContent = di.avg_daily_cost
      ? `$${di.avg_daily_cost}/day`
      : 'Varies';

    // Cities as tags
    const citiesEl = document.getElementById('destInfoCities');
    citiesEl.innerHTML = '';
    if (di.popular_cities) {
      di.popular_cities.split(',').forEach(city => {
        const tag = document.createElement('span');
        tag.className = 'city-tag';
        tag.textContent = city.trim();
        citiesEl.appendChild(tag);
      });
    }
    destInfoCard.style.display = 'block';
  } else {
    destInfoCard.style.display = 'none';
  }

  // ── Day Cards ──
  itineraryGrid.innerHTML = '';

  if (!data.itinerary || data.itinerary.length === 0) {
    itineraryGrid.innerHTML = '<p style="color:var(--text-muted);text-align:center;grid-column:1/-1">No itinerary data returned.</p>';
  } else {
    data.itinerary.forEach((day, index) => {
      const card = createDayCard(day, index + 1);
      // Staggered animation delay
      card.style.animationDelay = `${index * 0.08}s`;
      itineraryGrid.appendChild(card);
    });
  }

  // Show result section
  resultSection.style.display = 'block';
}

/* ─────────────────────────────────────────────────────────────
   CREATE DAY CARD
───────────────────────────────────────────────────────────── */
function createDayCard(day, dayNumber) {
  const card = document.createElement('div');
  card.className = 'day-card';

  // Use day object fields or fallback to full_text
  const morning   = day.morning   || '';
  const afternoon = day.afternoon || '';
  const evening   = day.evening   || '';
  const cost      = day.estimated_cost || '';
  const title     = day.title || `Day ${dayNumber}`;
  const notes     = day.notes || '';

  card.innerHTML = `
    <div class="day-card-header">
      <span class="day-number-label">Day ${dayNumber}</span>
      <span class="day-tag-badge">${escapeHtml(title)}</span>
    </div>
    <div class="day-card-body">
      ${morning ? `
        <div class="day-section">
          <div class="day-section-icon-title">
            <i class="ri-sun-line"></i> Morning
          </div>
          <p class="day-section-text">${escapeHtml(morning)}</p>
        </div>` : ''}

      ${afternoon ? `
        <div class="day-section">
          <div class="day-section-icon-title">
            <i class="ri-sun-foggy-line"></i> Afternoon
          </div>
          <p class="day-section-text">${escapeHtml(afternoon)}</p>
        </div>` : ''}

      ${evening ? `
        <div class="day-section">
          <div class="day-section-icon-title">
            <i class="ri-moon-line"></i> Evening
          </div>
          <p class="day-section-text">${escapeHtml(evening)}</p>
        </div>` : ''}

      ${notes ? `
        <div class="day-section">
          <div class="day-section-icon-title">
            <i class="ri-lightbulb-line"></i> Tips
          </div>
          <p class="day-section-text">${escapeHtml(notes)}</p>
        </div>` : ''}

      ${cost ? `
        <div class="day-cost-row">
          <span class="day-cost-label">Est. Daily Cost</span>
          <span class="day-cost-value">${escapeHtml(cost)}</span>
        </div>` : ''}
    </div>
  `;
  return card;
}

/* ─────────────────────────────────────────────────────────────
   SAVE TRIP
───────────────────────────────────────────────────────────── */
saveTripBtn.addEventListener('click', async () => {
  if (!currentTripData) { showToast('No trip to save.', 'error'); return; }

  saveTripBtn.disabled = true;
  saveTripBtn.innerHTML = '<span class="spinner"></span> Saving…';

  try {
    const response = await fetch('process.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:      'save',
        destination: currentTripData.destination,
        days:        currentTripData.days,
        budget:      currentTripData.budget,
        travelStyle: currentTripData.travelStyle,
        itinerary:   currentTripData.itinerary,
        raw:         currentTripData.raw || ''
      })
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to save trip.');
    }

    showToast('Trip saved successfully! 🎉', 'success');
    saveTripBtn.innerHTML = '<i class="ri-bookmark-fill"></i> Saved!';

    // Refresh history
    loadTripHistory();

  } catch (err) {
    console.error('Save error:', err);
    showToast(err.message, 'error');
    saveTripBtn.disabled = false;
    saveTripBtn.innerHTML = '<i class="ri-bookmark-line"></i> Save Trip';
  }
});

/* ─────────────────────────────────────────────────────────────
   LOAD TRIP HISTORY
───────────────────────────────────────────────────────────── */
async function loadTripHistory() {
  historyLoading.style.display = 'flex';
  historyEmpty.style.display   = 'none';
  tripsGrid.innerHTML           = '';

  try {
    const response = await fetch('process.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'history' })
    });

    const data = await response.json();

    historyLoading.style.display = 'none';

    if (!data.success || !data.trips || data.trips.length === 0) {
      historyEmpty.style.display = 'flex';
      return;
    }

    data.trips.forEach((trip, index) => {
      const card = createHistoryCard(trip);
      card.style.animationDelay = `${index * 0.06}s`;
      tripsGrid.appendChild(card);
    });

  } catch (err) {
    console.error('History load error:', err);
    historyLoading.style.display = 'none';
    historyEmpty.style.display   = 'flex';
  }
}

/* ─────────────────────────────────────────────────────────────
   CREATE HISTORY CARD
───────────────────────────────────────────────────────────── */
function createHistoryCard(trip) {
  const card = document.createElement('div');
  card.className = 'trip-history-card';

  const date = new Date(trip.created_at).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  // Preview: first 120 chars of raw itinerary text
  const preview = (trip.itinerary_text || '').substring(0, 140) + '…';

  card.innerHTML = `
    <div class="trip-hist-dest">${escapeHtml(trip.destination)}</div>
    <div class="trip-hist-meta">
      <span><i class="ri-calendar-line"></i> ${trip.days} days</span>
      <span><i class="ri-wallet-3-line"></i> $${Number(trip.budget).toLocaleString()}</span>
      ${trip.travel_style ? `<span><i class="ri-compass-3-line"></i> ${escapeHtml(trip.travel_style)}</span>` : ''}
    </div>
    <p class="trip-hist-preview">${escapeHtml(preview)}</p>
    <p class="trip-hist-date">${date}</p>
    <button class="btn-view-detail">View Full Itinerary <i class="ri-arrow-right-line"></i></button>
  `;

  // Open modal on button click
  card.querySelector('.btn-view-detail').addEventListener('click', () => {
    openTripModal(trip);
  });

  return card;
}

/* ─────────────────────────────────────────────────────────────
   TRIP DETAIL MODAL
───────────────────────────────────────────────────────────── */
function openTripModal(trip) {
  document.getElementById('modalTripTitle').textContent = `${trip.destination}`;
  document.getElementById('modalTripMeta').innerHTML = `
    <span><i class="ri-calendar-line"></i> ${trip.days} days</span>
    <span><i class="ri-wallet-3-line"></i> $${Number(trip.budget).toLocaleString()}</span>
    ${trip.travel_style ? `<span><i class="ri-compass-3-line"></i> ${escapeHtml(trip.travel_style)}</span>` : ''}
  `;

  const body = document.getElementById('modalTripBody');

  // Try to parse saved itinerary JSON, else show raw text
  let itinerary = null;
  try {
    itinerary = JSON.parse(trip.itinerary_json);
  } catch (_) {}

  if (itinerary && Array.isArray(itinerary) && itinerary.length > 0) {
    body.innerHTML = itinerary.map((day, i) => `
      <div class="modal-day-block">
        <h4 class="modal-day-title">Day ${i + 1} — ${escapeHtml(day.title || '')}</h4>
        <div class="modal-day-content">
          ${day.morning   ? `<strong>🌅 Morning:</strong> ${escapeHtml(day.morning)}\n\n`   : ''}
          ${day.afternoon ? `<strong>☀️ Afternoon:</strong> ${escapeHtml(day.afternoon)}\n\n` : ''}
          ${day.evening   ? `<strong>🌙 Evening:</strong> ${escapeHtml(day.evening)}\n\n`   : ''}
          ${day.notes     ? `<strong>💡 Tips:</strong> ${escapeHtml(day.notes)}\n\n`        : ''}
          ${day.estimated_cost ? `<strong>💰 Est. Cost:</strong> ${escapeHtml(day.estimated_cost)}` : ''}
        </div>
      </div>
    `).join('');
  } else {
    // Fallback: display raw text
    body.innerHTML = `<div class="modal-day-content" style="white-space:pre-line">${escapeHtml(trip.itinerary_text || 'No content available.')}</div>`;
  }

  tripDetailModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

// Close modal
modalClose.addEventListener('click', closeModal);
tripDetailModal.addEventListener('click', (e) => {
  if (e.target === tripDetailModal) closeModal();
});

function closeModal() {
  tripDetailModal.style.display = 'none';
  document.body.style.overflow = '';
}

// ESC key closes modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

/* ─────────────────────────────────────────────────────────────
   LOADING STATE HELPERS
───────────────────────────────────────────────────────────── */
function setLoadingState(isLoading) {
  generateBtn.disabled = isLoading;
  btnText.style.display    = isLoading ? 'none'  : 'flex';
  btnLoading.style.display = isLoading ? 'flex'  : 'none';
}

/* ─────────────────────────────────────────────────────────────
   TOAST NOTIFICATIONS
───────────────────────────────────────────────────────────── */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');

  const iconMap = {
    success: 'ri-checkbox-circle-line',
    error:   'ri-error-warning-line',
    info:    'ri-information-line'
  };

  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i class="${iconMap[type] || iconMap.info}"></i> ${escapeHtml(message)}`;
  toastContainer.appendChild(toast);

  // Auto-remove after 4s
  setTimeout(() => {
    toast.style.animation = 'toastOut .4s ease forwards';
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

/* ─────────────────────────────────────────────────────────────
   XSS PROTECTION — Escape HTML
───────────────────────────────────────────────────────────── */
function escapeHtml(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ─────────────────────────────────────────────────────────────
   LOAD DESTINATION SUGGESTIONS (autocomplete datalist)
───────────────────────────────────────────────────────────── */
async function loadDestinationSuggestions() {
  try {
    const response = await fetch('process.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'destinations' })
    });
    const data = await response.json();
    if (data.success && data.destinations) {
      const datalist = document.getElementById('destinationSuggestions');
      data.destinations.forEach(dest => {
        const opt = document.createElement('option');
        opt.value = dest;
        datalist.appendChild(opt);
      });
      // Also connect datalist to input
      document.getElementById('destination').setAttribute('list', 'destinationSuggestions');
    }
  } catch (_) {
    // Fail silently — suggestions are optional
  }
}

/* ─────────────────────────────────────────────────────────────
   SMOOTH SCROLL for nav links
───────────────────────────────────────────────────────────── */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', (e) => {
    const target = document.querySelector(anchor.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

/* ─────────────────────────────────────────────────────────────
   INIT — Run on page load
───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  loadTripHistory();
  loadDestinationSuggestions();
});
