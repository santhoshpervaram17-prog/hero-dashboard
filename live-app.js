// ===========================
// Hero Strike LIVE — Real-Time Engine
// ===========================

// Default MARKET values (used ONLY for simulation mode when NOT connected to Fyers)
const MARKET_DEFAULTS = {
    nifty: { name: 'NIFTY 50', spot: 23767, open: 23870, high: 23870, low: 23606, prev: 23870, lotSize: 25, strikeGap: 50, volatility: 0.12 },
    banknifty: { name: 'BANKNIFTY', spot: 51952, open: 52100, high: 52200, low: 51800, prev: 52100, lotSize: 15, strikeGap: 100, volatility: 0.18 },
    sensex: { name: 'SENSEX', spot: 78500, open: 78700, high: 78800, low: 78300, prev: 78700, lotSize: 10, strikeGap: 100, volatility: 0.10 }
};

// Live MARKET data — populated from Fyers API when connected, or from defaults for simulation
const MARKET = {
    nifty: { name: 'NIFTY 50', spot: 0, open: 0, high: 0, low: 0, prev: 0, lotSize: 25, strikeGap: 50, volatility: 0.12 },
    banknifty: { name: 'BANKNIFTY', spot: 0, open: 0, high: 0, low: 0, prev: 0, lotSize: 15, strikeGap: 100, volatility: 0.18 },
    sensex: { name: 'SENSEX', spot: 0, open: 0, high: 0, low: 0, prev: 0, lotSize: 10, strikeGap: 100, volatility: 0.10 }
};

let activeIndex = 'nifty';
let activeTimeframe = '1';
let chartData = [];
let activeStrategies = [];
let tickInterval = null;
let chartAnimFrame = null;
let vix = 14.25;
let pcr = 1.12;
let strategyIdCounter = 0;
let isConnectedToFyers = false;  // True when Fyers API is authenticated
let isFyersDataLoaded = false;   // True after first successful Fyers data fetch

// ===========================
// Market Hours Detection
// ===========================
function isMarketOpen() {
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 6=Sat
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const timeInMinutes = hours * 60 + minutes;
    
    // Market: Mon-Fri, 9:15 AM to 3:30 PM IST
    const marketOpen = 9 * 60 + 15;   // 9:15 AM = 555
    const marketClose = 15 * 60 + 30;  // 3:30 PM = 930
    
    if (day === 0 || day === 6) return false; // Weekend
    if (timeInMinutes < marketOpen || timeInMinutes > marketClose) return false;
    return true;
}

function getMarketStatusText() {
    const now = new Date();
    const day = now.getDay();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const timeInMinutes = hours * 60 + minutes;
    
    if (day === 0) return 'Closed · Sunday';
    if (day === 6) return 'Closed · Saturday';
    if (timeInMinutes < 9 * 60) return 'Pre-Market · Opens 9:15 AM';
    if (timeInMinutes < 9 * 60 + 15) return 'Pre-Open · Starts in ' + (9*60+15 - timeInMinutes) + ' min';
    if (timeInMinutes <= 15 * 60 + 30) return 'Market Open';
    return 'Closed · After Hours';
}

// ===========================
// Initialization
// ===========================
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const isFyersMode = urlParams.get('connected') === 'true';
    
    if (isFyersMode) {
        // ====== FYERS MODE ======
        // Do NOT generate any fake data. Wait for real API data.
        isConnectedToFyers = true;
        chartData = []; // Empty until real data arrives
        
        initIndexTabs();
        initBrokerModal(); // This will trigger startFyersLiveFeed()
    } else {
        // ====== SIMULATION MODE (demo/offline) ======
        // Copy default values into MARKET
        Object.keys(MARKET_DEFAULTS).forEach(key => {
            Object.assign(MARKET[key], MARKET_DEFAULTS[key]);
        });
        
        initMarketData(); // Generate fake chart data
        initIndexTabs();
        initOptionChain();
        initBrokerModal();
        startLiveFeed(); // Start simulation
    }
    
    updateClock();
    setInterval(updateClock, 1000);
});

// ===========================
// Market Data Generator
// ===========================
// Chart History & Market Data
// ===========================
async function fetchLiveChartHistory(indexName, resolution = '1') {
    const indexSymbol = indexName === 'banknifty' ? 'NSE:NIFTYBANK-INDEX' : (indexName === 'sensex' ? 'BSE:SENSEX-INDEX' : 'NSE:NIFTY50-INDEX');
    try {
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        const url = `/api/history?symbol=${encodeURIComponent(indexSymbol)}&resolution=${resolution}&date_format=1&range_from=${fiveDaysAgo}&range_to=${todayStr}`;
        const res = await fetch(url);
        const data = await res.json();
        
        if ((data.s === 'ok' || data.code === 200) && data.candles && data.candles.length > 0) {
            chartData = data.candles.map(c => ({
                time: new Date(c[0] * 1000),
                open: parseFloat(c[1]),
                high: parseFloat(c[2]),
                low: parseFloat(c[3]),
                close: parseFloat(c[4]),
                volume: parseInt(c[5], 10)
            }));
            if (chartData.length > 0) {
                MARKET[activeIndex].spot = chartData[chartData.length - 1].close;
            }
            console.log(`[Fyers] Historical candles loaded (${resolution}m, ${chartData.length} candles)`);
            return true;
        }
    } catch (err) {
        console.warn('[Fyers] History fetch failed:', err.message);
    }
    initMarketData(resolution);
    return false;
}

function initMarketData(tf = '1') {
    const idx = MARKET[activeIndex];
    let targetSpot = idx.spot || idx.open || 24000;
    const now = new Date();
    const stepMin = tf === '5' ? 5 : (tf === '15' ? 15 : 1);
    const count = tf === '15' ? 40 : (tf === '5' ? 60 : 120);
    const startTime = new Date(now.getTime() - count * stepMin * 60 * 1000);
    
    let price = targetSpot - (Math.random() - 0.48) * targetSpot * 0.005;
    chartData = [];
    for (let i = 0; i < count; i++) {
        const time = new Date(startTime.getTime() + i * stepMin * 60 * 1000);
        const volMultiplier = Math.sqrt(stepMin);
        const change = (Math.random() - 0.48) * targetSpot * 0.001 * volMultiplier;
        price += change;
        price = Math.max(idx.low - 50, Math.min(idx.high + 50, price));
        if (i === count - 1) price = targetSpot; // Ensure last candle matches exact live spot
        const rng = Math.random() * 15 * volMultiplier;
        chartData.push({
            time: time,
            open: price - Math.random() * 5 * volMultiplier,
            high: Math.max(price, price + rng),
            low: Math.min(price, price - rng),
            close: price,
            volume: Math.floor((Math.random() * 50000 + 10000) * stepMin)
        });
    }
    
    if (chartData.length > 0 && (typeof isFyersDataLoaded === 'undefined' || !isFyersDataLoaded)) {
        MARKET[activeIndex].spot = chartData[chartData.length - 1].close;
    }
}

function generateTick() {
    const idx = MARKET[activeIndex];
    const tickSize = idx.spot * 0.0002 * (1 + Math.random());
    const direction = Math.random() - 0.48; // Slight bullish bias
    const tick = direction * tickSize;
    
    idx.spot += tick;
    idx.spot = Math.round(idx.spot * 100) / 100;
    
    if (idx.spot > idx.high) idx.high = idx.spot;
    if (idx.spot < idx.low) idx.low = idx.spot;
    
    // Update last candle or create new
    const lastCandle = chartData[chartData.length - 1];
    const now = new Date();
    const candleMinute = lastCandle.time.getMinutes();
    const currentMinute = now.getMinutes();
    
    if (currentMinute !== candleMinute) {
        // New candle
        chartData.push({
            time: now,
            open: idx.spot,
            high: idx.spot,
            low: idx.spot,
            close: idx.spot,
            volume: Math.floor(Math.random() * 5000)
        });
        if (chartData.length > 300) chartData.shift();
    } else {
        lastCandle.close = idx.spot;
        if (idx.spot > lastCandle.high) lastCandle.high = idx.spot;
        if (idx.spot < lastCandle.low) lastCandle.low = idx.spot;
        lastCandle.volume += Math.floor(Math.random() * 500);
    }
    
    // Random VIX movement
    vix += (Math.random() - 0.5) * 0.05;
    vix = Math.max(10, Math.min(25, Math.round(vix * 100) / 100));
    
    // Update PCR
    pcr += (Math.random() - 0.5) * 0.01;
    pcr = Math.max(0.6, Math.min(1.6, Math.round(pcr * 100) / 100));
    
    // Also move other indices slightly
    Object.keys(MARKET).forEach(key => {
        if (key !== activeIndex) {
            const m = MARKET[key];
            const t = (Math.random() - 0.48) * m.spot * 0.0001;
            m.spot += t;
            m.spot = Math.round(m.spot * 100) / 100;
            if (m.spot > m.high) m.high = m.spot;
            if (m.spot < m.low) m.low = m.spot;
        }
    });
}

// ===========================
// Live Feed Loop (SIMULATION ONLY)
// ===========================
function startLiveFeed() {
    // Don't start simulation if connected to Fyers
    if (isConnectedToFyers) return;
    
    tickInterval = setInterval(() => {
        // Only simulate if NOT connected to Fyers
        if (!isConnectedToFyers) {
            generateTick();
        }
        updateUI();
    }, 800);
}

function updateUI() {
    updateTopBar();
    updateOptionChain();
    updateHeroSignals();
    
    const lastRefreshedEl = document.getElementById('last-refreshed');
    if (lastRefreshedEl) {
        const now = new Date();
        lastRefreshedEl.textContent = `(Last updated: ${now.toLocaleTimeString('en-IN', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' })})`;
    }
}

// ===========================
// Top Bar Updates
// ===========================
function updateTopBar() {
    Object.keys(MARKET).forEach(key => {
        const m = MARKET[key];
        const change = m.spot - m.prev;
        const changePct = (change / m.prev) * 100;
        
        const priceEl = document.getElementById(`${key}-price`);
        const changeEl = document.getElementById(`${key}-change`);
        
        if (priceEl) {
            priceEl.textContent = formatNum(m.spot);
            animateValue(priceEl);
        }
        if (changeEl) {
            const sign = change >= 0 ? '+' : '';
            changeEl.textContent = `${sign}${change.toFixed(2)} (${sign}${changePct.toFixed(2)}%)`;
            changeEl.className = `tab-change ${change >= 0 ? 'positive' : 'negative'}`;
        }
    });
    
    const vixEl = document.getElementById('vix-value');
    const pcrEl = document.getElementById('pcr-value');
    if (vixEl) vixEl.textContent = vix.toFixed(2);
    if (pcrEl) pcrEl.textContent = pcr.toFixed(2);
}

function updateChartFooter() {
    const idx = MARKET[activeIndex];
    document.getElementById('stat-open').textContent = formatNum(idx.open);
    document.getElementById('stat-high').textContent = formatNum(idx.high);
    document.getElementById('stat-low').textContent = formatNum(idx.low);
    document.getElementById('stat-ltp').textContent = formatNum(idx.spot);
    document.getElementById('stat-range').textContent = (idx.high - idx.low).toFixed(2);
    
    const maxPain = getMaxPainStrike();
    document.getElementById('stat-maxpain').textContent = formatNum(maxPain);
}

// ===========================
// Index Tabs
// ===========================
function initIndexTabs() {
    document.querySelectorAll('.index-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.index-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeIndex = tab.dataset.index;
            
            // In Fyers mode, switch to the newly selected index's spot price
            if (typeof isFyersDataLoaded !== 'undefined' && isFyersDataLoaded) {
                fetchLiveOptionChain(activeIndex, '').then(() => {
                    populateStrikeSelectors();
                    updateUI();
                });
            } else {
                initMarketData(activeTimeframe);
            }
            
            // Immediately update UI and selectors for the new index (prevents frozen Greeks/OI/Hero signals)
            populateStrikeSelectors();
            updateUI();
            showToast(`Switched to ${MARKET[activeIndex].name}`, 'info');
        });
    });
}

// ===========================
// Live Chart
// ===========================
function initChart() {
    document.querySelectorAll('.chart-tf').forEach(btn => {
        btn.addEventListener('click', async () => {
            document.querySelectorAll('.chart-tf').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tf = btn.dataset.tf || '1m';
            activeTimeframe = tf === '5m' ? '5' : (tf === '15m' ? '15' : '1');
            showToast(`⏳ Loading ${tf} chart...`, 'info');
            
            if (typeof isFyersDataLoaded !== 'undefined' && isFyersDataLoaded) {
                await fetchLiveChartHistory(activeIndex, activeTimeframe);
            } else {
                initMarketData(activeTimeframe);
            }
            drawChart();
            showToast(`Switched to ${tf} timeframe`, 'info');
        });
    });
    drawChart();
}

function drawChart() {
    const canvas = document.getElementById('live-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.scale(dpr, dpr);
    
    const w = rect.width;
    const h = rect.height;
    const pad = { t: 16, r: 60, b: 24, l: 12 };
    const cw = w - pad.l - pad.r;
    const ch = h - pad.t - pad.b;
    
    if (chartData.length < 2) return;
    
    const prices = chartData.map(d => d.close);
    const minP = Math.min(...prices) - 10;
    const maxP = Math.max(...prices) + 10;
    const pRange = maxP - minP || 1;
    
    // Clear
    ctx.clearRect(0, 0, w, h);
    
    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = pad.t + (ch / 4) * i;
        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(w - pad.r, y);
        ctx.stroke();
        
        // Price labels
        const price = maxP - (pRange / 4) * i;
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(formatNum(price), w - pad.r + 6, y + 4);
    }
    
    // Previous close line
    const idx = MARKET[activeIndex];
    const prevY = pad.t + ((maxP - idx.prev) / pRange) * ch;
    ctx.strokeStyle = 'rgba(255, 215, 64, 0.2)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.l, prevY);
    ctx.lineTo(w - pad.r, prevY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    ctx.fillStyle = 'rgba(255, 215, 64, 0.4)';
    ctx.font = '9px JetBrains Mono';
    ctx.textAlign = 'left';
    ctx.fillText('Prev', w - pad.r + 6, prevY - 4);
    
    // Area fill
    const gradient = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
    const lastPrice = prices[prices.length - 1];
    const isUp = lastPrice >= idx.prev;
    
    if (isUp) {
        gradient.addColorStop(0, 'rgba(0, 230, 118, 0.15)');
        gradient.addColorStop(1, 'rgba(0, 230, 118, 0)');
    } else {
        gradient.addColorStop(0, 'rgba(255, 82, 82, 0.15)');
        gradient.addColorStop(1, 'rgba(255, 82, 82, 0)');
    }
    
    ctx.beginPath();
    chartData.forEach((d, i) => {
        const x = pad.l + (i / (chartData.length - 1)) * cw;
        const y = pad.t + ((maxP - d.close) / pRange) * ch;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.lineTo(pad.l + cw, h - pad.b);
    ctx.lineTo(pad.l, h - pad.b);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    
    // Line
    ctx.beginPath();
    chartData.forEach((d, i) => {
        const x = pad.l + (i / (chartData.length - 1)) * cw;
        const y = pad.t + ((maxP - d.close) / pRange) * ch;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = isUp ? '#00e676' : '#ff5252';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Current price dot
    const lastX = pad.l + cw;
    const lastY = pad.t + ((maxP - lastPrice) / pRange) * ch;
    
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = isUp ? '#00e676' : '#ff5252';
    ctx.fill();
    
    // Glow
    ctx.beginPath();
    ctx.arc(lastX, lastY, 8, 0, Math.PI * 2);
    ctx.fillStyle = isUp ? 'rgba(0, 230, 118, 0.2)' : 'rgba(255, 82, 82, 0.2)';
    ctx.fill();
    
    // Current price label
    ctx.fillStyle = isUp ? '#00e676' : '#ff5252';
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(formatNum(lastPrice), w - pad.r + 6, lastY + 4);
    
    // Time labels
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '9px JetBrains Mono';
    ctx.textAlign = 'center';
    const timeLabels = 6;
    for (let i = 0; i <= timeLabels; i++) {
        const idx2 = Math.floor((chartData.length - 1) * (i / timeLabels));
        if (chartData[idx2]) {
            const t = chartData[idx2].time;
            const x = pad.l + (idx2 / (chartData.length - 1)) * cw;
            ctx.fillText(`${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}`, x, h - 4);
        }
    }
}

// ===========================
// Option Chain
// ===========================
function initOptionChain() {
    updateOptionChain();
    populateStrikeSelectors();
    
    const expirySelect = document.getElementById('expiry-select');
    if (expirySelect && !expirySelect.dataset.listener) {
        expirySelect.dataset.listener = 'true';
        expirySelect.addEventListener('change', async () => {
            if (isConnectedToFyers && typeof isFyersDataLoaded !== 'undefined' && isFyersDataLoaded) {
                showToast(`⏳ Fetching option chain for ${expirySelect.value}...`, 'info');
                await fetchLiveOptionChain(activeIndex, expirySelect.value);
                updateUI();
            } else {
                showToast(`Switched expiry to ${expirySelect.options[expirySelect.selectedIndex].text}`, 'info');
            }
        });
    }
}

function getStrikes() {
    const idx = MARKET[activeIndex];
    const gap = idx.strikeGap;
    const atmStrike = Math.round(idx.spot / gap) * gap;
    const strikes = [];
    for (let i = -8; i <= 8; i++) {
        strikes.push(atmStrike + i * gap);
    }
    return { strikes, atmStrike };
}

function getMaxPainStrike() {
    if (!chainDataCache || chainDataCache.length === 0) {
        return getStrikes().atmStrike;
    }
    let minPain = Infinity;
    let maxPainStrike = getStrikes().atmStrike;
    
    chainDataCache.forEach(targetRow => {
        const k = targetRow.strike;
        let totalPain = 0;
        chainDataCache.forEach(row => {
            const s = row.strike;
            if (k > s) {
                totalPain += (k - s) * (row.ce.oi || 0);
            } else if (k < s) {
                totalPain += (s - k) * (row.pe.oi || 0);
            }
        });
        if (totalPain < minPain) {
            minPain = totalPain;
            maxPainStrike = k;
        }
    });
    return maxPainStrike;
}

function generateOptionData(strike, atmStrike) {
    const idx = MARKET[activeIndex];
    const spot = idx.spot;
    const diff = strike - spot;
    const moneyness = Math.abs(diff) / spot;
    
    // Simulate realistic option prices
    const daysToExpiry = 2; // Close to expiry
    const iv = (15 + Math.random() * 10 + moneyness * 50) / 100;
    
    // Simplified Black-Scholes-like pricing
    const timeValue = Math.max(0.5, daysToExpiry * 2) * (1 - moneyness * 3);
    
    let cePrice, pePrice;
    if (diff >= 0) {
        // OTM Call, ITM Put
        cePrice = Math.max(0.05, timeValue * (1 - moneyness * 5) * 50 + Math.random() * 5);
        pePrice = Math.max(0.05, Math.abs(diff) + timeValue * 30 + Math.random() * 5);
    } else {
        // ITM Call, OTM Put
        cePrice = Math.max(0.05, Math.abs(diff) + timeValue * 30 + Math.random() * 5);
        pePrice = Math.max(0.05, timeValue * (1 - moneyness * 5) * 50 + Math.random() * 5);
    }
    
    cePrice = Math.round(cePrice * 100) / 100;
    pePrice = Math.round(pePrice * 100) / 100;
    
    // OI (higher at round strikes, higher at support/resistance)
    const baseOI = 100000 + Math.random() * 200000;
    const roundBonus = (strike % 500 === 0) ? 150000 : (strike % 100 === 0) ? 50000 : 0;
    
    const ceOI = Math.floor(baseOI + roundBonus * (diff > 0 ? 1.5 : 0.5) + Math.random() * 50000);
    const peOI = Math.floor(baseOI + roundBonus * (diff < 0 ? 1.5 : 0.5) + Math.random() * 50000);
    
    const ceOIChange = Math.floor((Math.random() - 0.4) * 30000);
    const peOIChange = Math.floor((Math.random() - 0.4) * 30000);
    
    const ceVol = Math.floor(Math.random() * 50000 + 5000);
    const peVol = Math.floor(Math.random() * 50000 + 5000);
    
    const ceChange = Math.round((Math.random() - 0.45) * cePrice * 0.3 * 100) / 100;
    const peChange = Math.round((Math.random() - 0.55) * pePrice * 0.3 * 100) / 100;
    
    return {
        strike,
        isATM: strike === atmStrike,
        ce: { ltp: cePrice, change: ceChange, oi: ceOI, oiChange: ceOIChange, vol: ceVol, iv: (iv * 100).toFixed(1) },
        pe: { ltp: pePrice, change: peChange, oi: peOI, oiChange: peOIChange, vol: peVol, iv: (iv * 100).toFixed(1) }
    };
}

// Store chain data for consistent updates
let chainDataCache = null;

function updateOptionChain() {
    const idx = MARKET[activeIndex];
    // Don't generate chain if we don't have valid spot price yet
    if (!idx.spot || idx.spot === 0) return;
    
    const { strikes, atmStrike } = getStrikes();
    const tbody = document.getElementById('chain-body');
    
    // Generate or update chain data (do NOT overwrite real Fyers data with random simulation when connected)
    if (!chainDataCache || chainDataCache.length !== strikes.length || chainDataCache[0].strike !== strikes[0]) {
        if (!isConnectedToFyers || !chainDataCache) {
            chainDataCache = strikes.map(s => generateOptionData(s, atmStrike));
        }
    } else if (!isConnectedToFyers && isMarketOpen()) {
        // Only randomize in simulation mode AND during market hours
        chainDataCache.forEach(row => {
            const smallChange = (Math.random() - 0.5) * 2;
            row.ce.ltp = Math.max(0.05, Math.round((row.ce.ltp + smallChange * 0.3) * 100) / 100);
            row.pe.ltp = Math.max(0.05, Math.round((row.pe.ltp - smallChange * 0.2) * 100) / 100);
            row.ce.change = Math.round((Math.random() - 0.45) * 5 * 100) / 100;
            row.pe.change = Math.round((Math.random() - 0.55) * 5 * 100) / 100;
        });
    }
    // Set realistic index-specific base VIX in simulation mode
    if (!isConnectedToFyers) {
        vix = activeIndex === 'banknifty' ? 15.85 : (activeIndex === 'sensex' ? 13.40 : 14.25);
    }
    // When connected to Fyers OR market is closed: keep chain data static (no random updates)
    
    // Find max OI for highlighting
    const maxCeOI = Math.max(...chainDataCache.map(r => r.ce.oi));
    const maxPeOI = Math.max(...chainDataCache.map(r => r.pe.oi));
    
    let totalCeOI = 0, totalPeOI = 0;
    
    tbody.innerHTML = chainDataCache.map(row => {
        totalCeOI += row.ce.oi;
        totalPeOI += row.pe.oi;
        
        const isATM = row.strike === atmStrike;
        const ceOIHigh = row.ce.oi === maxCeOI;
        const peOIHigh = row.pe.oi === maxPeOI;
        
        return `<tr class="${isATM ? 'atm-row' : ''}">
            <td class="${ceOIHigh ? 'oi-high-ce' : ''}">${formatCompact(row.ce.oi)}</td>
            <td class="${row.ce.oiChange >= 0 ? 'positive' : 'negative'}">${row.ce.oiChange >= 0 ? '+' : ''}${formatCompact(row.ce.oiChange)}</td>
            <td class="dim">${formatCompact(row.ce.vol)}</td>
            <td class="dim">${row.ce.iv}%</td>
            <td class="ce-ltp">${row.ce.ltp.toFixed(2)}</td>
            <td class="${row.ce.change >= 0 ? 'positive' : 'negative'}">${row.ce.change >= 0 ? '+' : ''}${row.ce.change.toFixed(2)}</td>
            <td class="strike-cell">${isATM ? '★ ' : ''}${formatNum(row.strike)}</td>
            <td class="${row.pe.change >= 0 ? 'positive' : 'negative'}">${row.pe.change >= 0 ? '+' : ''}${row.pe.change.toFixed(2)}</td>
            <td class="pe-ltp">${row.pe.ltp.toFixed(2)}</td>
            <td class="dim">${row.pe.iv}%</td>
            <td class="dim">${formatCompact(row.pe.vol)}</td>
            <td class="${row.pe.oiChange >= 0 ? 'positive' : 'negative'}">${row.pe.oiChange >= 0 ? '+' : ''}${formatCompact(row.pe.oiChange)}</td>
            <td class="${peOIHigh ? 'oi-high-pe' : ''}">${formatCompact(row.pe.oi)}</td>
        </tr>`;
    }).join('');
    
    // Update summary
    document.getElementById('total-ce-oi').textContent = formatCompact(totalCeOI);
    document.getElementById('total-pe-oi').textContent = formatCompact(totalPeOI);
    pcr = totalPeOI / (totalCeOI || 1);
    document.getElementById('pcr-oi').textContent = pcr.toFixed(2);
    const pcrTopEl = document.getElementById('pcr-value');
    if (pcrTopEl) pcrTopEl.textContent = pcr.toFixed(2);
    document.getElementById('max-pain-val').textContent = formatNum(atmStrike);
}

function populateStrikeSelectors() {
    const { strikes } = getStrikes();
    const buildSelect = document.getElementById('build-strike');
    const greekSelect = document.getElementById('greek-strike-select');
    
    const options = strikes.map(s => `<option value="${s}">${formatNum(s)}</option>`).join('');
    
    if (buildSelect) buildSelect.innerHTML = options;
    if (greekSelect) greekSelect.innerHTML = options;
    
    // Select ATM
    const atm = strikes[Math.floor(strikes.length / 2)];
    if (buildSelect) buildSelect.value = atm;
    if (greekSelect) greekSelect.value = atm;
}

// ===========================
// Strategy Monitor
// ===========================
function initStrategyMonitor() {
    const addBtn = document.getElementById('add-strategy-btn');
    const builder = document.getElementById('strategy-builder');
    const deployBtn = document.getElementById('builder-add-btn');
    const cancelBtn = document.getElementById('builder-cancel-btn');
    
    addBtn.addEventListener('click', () => {
        builder.style.display = builder.style.display === 'none' ? 'block' : 'none';
        populateStrikeSelectors();
    });
    
    cancelBtn.addEventListener('click', () => {
        builder.style.display = 'none';
    });
    
    deployBtn.addEventListener('click', () => {
        const type = document.getElementById('build-strategy-type').value;
        const strike = parseInt(document.getElementById('build-strike').value);
        const lots = parseInt(document.getElementById('build-lots').value);
        
        addStrategy(type, strike, lots);
        builder.style.display = 'none';
        showToast(`Strategy deployed: ${getStrategyName(type)} @ ${formatNum(strike)}`, 'success');
    });
    
    // Add a demo strategy
    addStrategy('hedged', getStrikes().atmStrike, 1);
}

function addStrategy(type, strike, lots) {
    const idx = MARKET[activeIndex];
    const entrySpot = idx.spot;
    
    const strategy = {
        id: ++strategyIdCounter,
        type,
        strike,
        lots,
        index: activeIndex,
        entrySpot,
        entryTime: new Date()
    };
    
    activeStrategies.push(strategy);
    document.getElementById('no-strategies').style.display = 'none';
    updateStrategies();
}

function removeStrategy(id) {
    activeStrategies = activeStrategies.filter(s => s.id !== id);
    if (activeStrategies.length === 0) {
        document.getElementById('no-strategies').style.display = 'flex';
    }
    updateStrategies();
    showToast('Strategy removed', 'info');
}

function updateStrategies() {
    const container = document.getElementById('active-strategies');
    let currentStrategies = activeStrategies.filter(s => s.index === activeIndex);
    
    if (currentStrategies.length === 0) {
        // Automatically add a demo strategy for the newly selected index if none exist
        const atm = getStrikes().atmStrike;
        if (atm > 0) {
            addStrategy('hedged', atm, 1);
            currentStrategies = activeStrategies.filter(s => s.index === activeIndex);
        }
    }
    
    if (currentStrategies.length === 0) {
        container.innerHTML = '';
        document.getElementById('no-strategies').style.display = 'flex';
        return;
    }
    
    document.getElementById('no-strategies').style.display = 'none';
    
    container.innerHTML = currentStrategies.map(s => {
        const idx = MARKET[s.index];
        // Fix any strategy created with 0 entrySpot/strike before Fyers data loaded
        if (s.entrySpot === 0 && idx.spot > 0) s.entrySpot = idx.spot;
        if (s.strike === 0 && idx.spot > 0) s.strike = Math.round(idx.spot / idx.strikeGap) * idx.strikeGap;
        
        const currentSpot = idx.spot;
        const move = currentSpot - s.entrySpot;
        
        // Calculate P&L based on strategy type
        const pnl = calculateLivePnL(s.type, s.entrySpot, currentSpot, s.strike, idx.lotSize * s.lots);
        const pnlPct = ((pnl / (idx.lotSize * s.lots * 200)) * 100).toFixed(1); // Approximate
        const isPositive = pnl >= 0;
        
        const icons = { straddle: '⚡', strangle: '🔀', bullcall: '🐂', bearput: '🐻', ironcondor: '🦅', hedged: '🛡️' };
        
        return `
            <div class="strategy-item">
                <span class="strat-type">${icons[s.type] || '📊'}</span>
                <div class="strat-info">
                    <span class="strat-name">${getStrategyName(s.type)}</span>
                    <span class="strat-detail">${MARKET[s.index].name} | Strike: ${formatNum(s.strike)} | ${s.lots} Lot | Move: ${move >= 0 ? '+' : ''}${move.toFixed(1)}</span>
                </div>
                <div class="strat-pnl ${isPositive ? 'positive' : 'negative'}">
                    ${isPositive ? '+' : ''}₹${Math.abs(Math.round(pnl)).toLocaleString('en-IN')}
                    <span class="strat-pnl-pct">${isPositive ? '+' : ''}${pnlPct}%</span>
                </div>
                <button class="strat-close-btn" onclick="removeStrategy(${s.id})">✕</button>
            </div>
        `;
    }).join('');
}

function calculateLivePnL(type, entrySpot, currentSpot, strike, qty) {
    const move = currentSpot - entrySpot;
    const cePrem = 200;
    const pePrem = 200;
    const spread = 200;
    
    switch(type) {
        case 'straddle': {
            const cePayoff = Math.max(0, currentSpot - strike) - cePrem;
            const pePayoff = Math.max(0, strike - currentSpot) - pePrem;
            return (cePayoff + pePayoff) * qty;
        }
        case 'strangle': {
            const cePayoff = Math.max(0, currentSpot - (strike + 100)) - cePrem * 0.4;
            const pePayoff = Math.max(0, (strike - 100) - currentSpot) - pePrem * 0.4;
            return (cePayoff + pePayoff) * qty;
        }
        case 'bullcall': {
            const buyPayoff = Math.max(0, currentSpot - strike);
            const sellPayoff = -Math.max(0, currentSpot - (strike + spread));
            const netDebit = cePrem * 0.7;
            return (buyPayoff + sellPayoff - netDebit) * qty;
        }
        case 'bearput': {
            const buyPayoff = Math.max(0, strike - currentSpot);
            const sellPayoff = -Math.max(0, (strike - spread) - currentSpot);
            const netDebit = pePrem * 0.7;
            return (buyPayoff + sellPayoff - netDebit) * qty;
        }
        case 'ironcondor': {
            const credit = cePrem * 0.15 + pePrem * 0.15;
            let loss = 0;
            if (currentSpot > strike + spread) loss = Math.min(currentSpot - (strike + spread), 100);
            if (currentSpot < strike - spread) loss = Math.min((strike - spread) - currentSpot, 100);
            return (credit - loss) * qty;
        }
        case 'hedged': {
            const netDebit = (cePrem + pePrem) * 0.5;
            const cePayoff = Math.max(0, currentSpot - strike) - Math.max(0, currentSpot - (strike + spread));
            const pePayoff = Math.max(0, strike - currentSpot) - Math.max(0, (strike - spread) - currentSpot);
            return (cePayoff + pePayoff - netDebit) * qty;
        }
        default:
            return move * qty;
    }
}

function getStrategyName(type) {
    const names = {
        straddle: 'Long Straddle',
        strangle: 'Long Strangle',
        bullcall: 'Bull Call Spread',
        bearput: 'Bear Put Spread',
        ironcondor: 'Iron Condor',
        hedged: 'Hedged Straddle'
    };
    return names[type] || type;
}

// ===========================
// Greeks Panel
// ===========================
function initGreeksPanel() {
    // Tab switching
    document.querySelectorAll('.greek-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.greek-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.greek-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
            
            if (tab.dataset.tab === 'oi-analysis') {
                drawOIChart();
            }
        });
    });
    
    updateGreeks();
}

function updateGreeks() {
    const idx = MARKET[activeIndex];
    const strikeSelect = document.getElementById('greek-strike-select');
    const strike = strikeSelect ? parseInt(strikeSelect.value) : getStrikes().atmStrike;
    const diff = (strike - idx.spot) / (idx.spot || 1);
    const moneyness = Math.abs(diff);
    
    // Scale Greeks realistically by index characteristics and spot price
    const deltaSlope = activeIndex === 'sensex' ? 8 : (activeIndex === 'banknifty' ? 6 : 5);
    const delta = Math.max(0.01, Math.min(0.99, 0.5 + diff * deltaSlope));
    const gammaScale = activeIndex === 'sensex' ? 0.0015 : (activeIndex === 'banknifty' ? 0.0022 : 0.0050);
    const gamma = Math.max(0.0001, gammaScale * (1 - moneyness * 10));
    const thetaScale = activeIndex === 'sensex' ? 35 : (activeIndex === 'banknifty' ? 25 : 12);
    const theta = -(thetaScale + Math.random() * (thetaScale * 0.3)) * Math.max(0.2, 1 - moneyness * 3);
    const vegaScale = activeIndex === 'sensex' ? 18 : (activeIndex === 'banknifty' ? 12 : 5);
    const vega = Math.max(0.5, vegaScale * (1 - moneyness * 5));
    
    document.getElementById('delta-ce').textContent = `CE: ${delta.toFixed(2)}`;
    document.getElementById('delta-pe').textContent = `PE: ${(delta - 1).toFixed(2)}`;
    document.getElementById('delta-bar').style.setProperty('--val', `${delta * 100}%`);
    
    document.getElementById('gamma-ce').textContent = `CE: ${gamma.toFixed(4)}`;
    document.getElementById('gamma-pe').textContent = `PE: ${gamma.toFixed(4)}`;
    document.getElementById('gamma-bar').style.setProperty('--val', `${Math.min(100, gamma * 20000)}%`);
    
    document.getElementById('theta-ce').textContent = `CE: ${theta.toFixed(2)}`;
    document.getElementById('theta-pe').textContent = `PE: ${(theta * 0.95).toFixed(2)}`;
    document.getElementById('theta-bar').style.setProperty('--val', `${Math.min(100, Math.abs(theta) * 5)}%`);
    
    document.getElementById('vega-ce').textContent = `CE: ${vega.toFixed(2)}`;
    document.getElementById('vega-pe').textContent = `PE: ${vega.toFixed(2)}`;
    document.getElementById('vega-bar').style.setProperty('--val', `${Math.min(100, vega * 15)}%`);
}

// ===========================
// OI Chart
// ===========================
function drawOIChart() {
    const canvas = document.getElementById('oi-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 220 * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = '220px';
    ctx.scale(dpr, dpr);
    
    const w = rect.width;
    const h = 220;
    const pad = { t: 20, r: 10, b: 30, l: 10 };
    
    if (!chainDataCache) return;
    
    const barWidth = Math.max(8, (w - pad.l - pad.r) / chainDataCache.length / 2 - 4);
    const maxOI = Math.max(...chainDataCache.map(r => Math.max(r.ce.oi, r.pe.oi)));
    
    ctx.clearRect(0, 0, w, h);
    
    chainDataCache.forEach((row, i) => {
        const x = pad.l + (i / chainDataCache.length) * (w - pad.l - pad.r) + barWidth;
        const ceH = (row.ce.oi / maxOI) * (h - pad.t - pad.b);
        const peH = (row.pe.oi / maxOI) * (h - pad.t - pad.b);
        
        // CE bar
        ctx.fillStyle = 'rgba(0, 230, 118, 0.4)';
        ctx.fillRect(x - barWidth - 1, h - pad.b - ceH, barWidth, ceH);
        
        // PE bar
        ctx.fillStyle = 'rgba(255, 82, 82, 0.4)';
        ctx.fillRect(x + 1, h - pad.b - peH, barWidth, peH);
        
        // Strike label
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '8px JetBrains Mono';
        ctx.textAlign = 'center';
        if (i % 2 === 0 || row.isATM) {
            ctx.fillText((row.strike / 1000).toFixed(1) + 'K', x, h - 6);
        }
        
        if (row.isATM) {
            ctx.fillStyle = 'rgba(68, 138, 255, 0.3)';
            ctx.fillRect(x - barWidth - 2, pad.t, barWidth * 2 + 4, h - pad.t - pad.b);
        }
    });
    
    // Legend
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = 'rgba(0, 230, 118, 0.7)';
    ctx.fillRect(10, 6, 10, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.textAlign = 'left';
    ctx.fillText('CE OI', 24, 15);
    
    ctx.fillStyle = 'rgba(255, 82, 82, 0.7)';
    ctx.fillRect(70, 6, 10, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('PE OI', 84, 15);
    
    // Dynamically update OI Insights for active index
    if (chainDataCache && chainDataCache.length > 0) {
        let maxCeStrike = chainDataCache[0].strike, maxCeVal = -1;
        let maxPeStrike = chainDataCache[0].strike, maxPeVal = -1;
        chainDataCache.forEach(row => {
            if ((row.ce.oi || 0) > maxCeVal) { maxCeVal = row.ce.oi || 0; maxCeStrike = row.strike; }
            if ((row.pe.oi || 0) > maxPeVal) { maxPeVal = row.pe.oi || 0; maxPeStrike = row.strike; }
        });
        
        const el1 = document.getElementById('oi-insight-1');
        const el2 = document.getElementById('oi-insight-2');
        const el3 = document.getElementById('oi-insight-3');
        const el4 = document.getElementById('oi-insight-4');
        
        if (el1) el1.innerHTML = `Highest CE OI at <strong>${formatNum(maxCeStrike)}</strong> — Strong resistance`;
        if (el2) el2.innerHTML = `Highest PE OI at <strong>${formatNum(maxPeStrike)}</strong> — Strong support`;
        if (el3) {
            const lowR = Math.min(maxCeStrike, maxPeStrike);
            const highR = Math.max(maxCeStrike, maxPeStrike);
            el3.innerHTML = `Expected range: <strong>${formatNum(lowR)} – ${formatNum(highR)}</strong>`;
        }
        if (el4) {
            const mp = getMaxPainStrike();
            el4.innerHTML = `Max Pain: <strong>${formatNum(mp)}</strong> — Market gravitating here`;
        }
    }
}

// ===========================
// Hero Signals
// ===========================
function updateHeroSignals() {
    const idx = MARKET[activeIndex];
    const priceUp = idx.spot > idx.prev;
    const pcrBullish = pcr > 1.0;
    const vixNeutral = vix > 13 && vix < 18;
    
    // Check VWAP (approximate using (H+L+C)/3 for index, or directly if available)
    const high = idx.high || idx.spot;
    const low = idx.low || idx.spot;
    const vwap = (high + low + idx.spot) / 3;
    const aboveVWAP = idx.spot > vwap;
    
    let bullishScore = 50;
    if (priceUp) bullishScore += 10;
    if (pcrBullish) bullishScore += 10;
    if (vix < 14) bullishScore += 5;
    if (aboveVWAP) bullishScore += 15;
    
    // Only add random jitter during live simulation in market hours
    if (!isConnectedToFyers && isMarketOpen()) {
        bullishScore += (Math.random() - 0.5) * 5;
    }
    bullishScore = Math.max(20, Math.min(85, bullishScore));
    
    const isBullish = bullishScore > 50;
    
    const confidence = Math.round(bullishScore > 50 ? bullishScore : 100 - bullishScore);
    document.getElementById('signal-score').textContent = `${confidence}% Confidence`;
    
    const predSide = document.getElementById('signal-direction');
    if (predSide) {
        predSide.innerHTML = `
            <span class="direction-text ${isBullish ? '' : 'bearish-text'}">${isBullish ? 'CALLS (CE)' : 'PUTS (PE)'}</span>
            <span class="direction-desc">${isBullish ? 'Strong support building, upward momentum.' : 'Heavy resistance, downward pressure.'}</span>
        `;
    }
    
    // Update factor meters
    const updateFactor = (id, condition, bullishText, bearishText, neutralText = 'Neutral') => {
        const el = document.getElementById(`fb-${id}`);
        const lbl = document.getElementById(`fs-${id}`);
        if (!el || !lbl) return;
        
        if (condition === true) {
            el.style.width = '70%';
            el.className = 'factor-bar bullish';
            lbl.textContent = bullishText;
            lbl.className = 'factor-status bullish-label';
        } else if (condition === false) {
            el.style.width = '30%';
            el.className = 'factor-bar bearish';
            lbl.textContent = bearishText;
            lbl.className = 'factor-status bearish-label';
        } else {
            el.style.width = '50%';
            el.className = 'factor-bar';
            lbl.textContent = neutralText;
            lbl.className = 'factor-status';
        }
    };
    
    updateFactor('oi', isBullish, 'Bullish', 'Bearish');
    updateFactor('pcr', pcrBullish, 'Mildly Bullish', 'Mildly Bearish');
    updateFactor('price', priceUp, 'Bullish', 'Bearish');
    updateFactor('vwap', aboveVWAP, 'Above VWAP (Bullish)', 'Below VWAP (Bearish)');

    const vixEl = document.getElementById('fb-vix');
    const vixLbl = document.getElementById('fs-vix');
    if (vixEl && vixLbl) {
        const isVixCalm = vix < 15;
        vixEl.style.width = `${Math.min(100, Math.max(20, (vix / 30) * 100))}%`;
        vixEl.className = `factor-bar ${isVixCalm ? 'bullish' : (vix > 18 ? 'bearish' : '')}`;
        vixLbl.textContent = isVixCalm ? 'Calm / Favorable' : (vix > 18 ? 'High Volatility' : 'Neutral');
        vixLbl.className = `factor-status ${isVixCalm ? 'bullish-label' : (vix > 18 ? 'bearish-label' : '')}`;
    }

    const unwindEl = document.getElementById('fb-unwind');
    const unwindLbl = document.getElementById('fs-unwind');
    if (unwindEl && unwindLbl && typeof chainDataCache !== 'undefined' && chainDataCache && chainDataCache.length > 0) {
        const totalCeChg = chainDataCache.reduce((sum, r) => sum + (r.ce.oiChange || 0), 0);
        const totalPeChg = chainDataCache.reduce((sum, r) => sum + (r.pe.oiChange || 0), 0);
        const isUnwindingBullish = totalPeChg >= totalCeChg;
        unwindEl.style.width = `${isUnwindingBullish ? 70 : 30}%`;
        unwindEl.className = `factor-bar ${isUnwindingBullish ? 'bullish' : 'bearish'}`;
        unwindLbl.textContent = isUnwindingBullish ? 'Call Unwinding' : 'Put Selling / Unwinding';
        unwindLbl.className = `factor-status ${isUnwindingBullish ? 'bullish-label' : 'bearish-label'}`;
    }

    // Recommended strategy
    const rec = document.getElementById('rec-strategy');
    const { atmStrike } = getStrikes();
    const gap = MARKET[activeIndex].strikeGap;
    
    if (rec) {
        if (isBullish && confidence > 65) {
            rec.innerHTML = `<span style="color:var(--green)">Bull Call Spread (${formatNum(atmStrike)} / ${formatNum(atmStrike + gap * 4)})</span>`;
        } else if (!isBullish && confidence > 65) {
            rec.innerHTML = `<span style="color:var(--red)">Bear Put Spread (${formatNum(atmStrike)} / ${formatNum(atmStrike - gap * 4)})</span>`;
        } else if (vix > 16) {
            rec.innerHTML = `<span style="color:var(--text-muted)">Hedged Straddle (${formatNum(atmStrike)} ± ${formatNum(gap * 4)})</span>`;
        } else {
            rec.innerHTML = `<span style="color:var(--text-muted)">Iron Condor (${formatNum(atmStrike - gap * 4)} – ${formatNum(atmStrike + gap * 4)})</span>`;
        }
    }
}

// ===========================
// Fyers Broker Modal & Login
// ===========================
function initBrokerModal() {
    const modal = document.getElementById('broker-modal');
    const connectBtn = document.getElementById('connect-btn');
    const closeBtn = document.getElementById('modal-close');
    const cancelBtn = document.getElementById('modal-cancel');
    const loginBtn = document.getElementById('fyers-login-btn');
    
    connectBtn.addEventListener('click', () => {
        modal.style.display = 'flex';
        const redirectDisplay = document.getElementById('redirect-url-display');
        if (redirectDisplay) redirectDisplay.textContent = window.location.origin + '/callback';
        checkFyersServer();
    });
    
    closeBtn.addEventListener('click', () => modal.style.display = 'none');
    cancelBtn.addEventListener('click', () => modal.style.display = 'none');
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });
    
    loginBtn.addEventListener('click', () => {
        fyersLogin();
    });
    
    // Check if redirected back from Fyers auth with connected=true
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('connected') === 'true') {
        isConnectedToFyers = true;
        
        // Stop any simulation immediately
        if (tickInterval) {
            clearInterval(tickInterval);
            tickInterval = null;
        }
        
        const statusDot = document.querySelector('.status-dot');
        const statusText = document.querySelector('.status-text');
        statusDot.className = 'status-dot live';
        statusText.textContent = 'Fyers Live';
        
        if (connectBtn) {
            connectBtn.innerHTML = '<span class="connect-icon">✅</span> Connected';
            connectBtn.style.background = '#059669';
            connectBtn.style.borderColor = '#10b981';
        }
        
        // Start fetching real data
        startFyersLiveFeed();
    }
}

async function checkFyersServer() {
    const card = document.getElementById('server-status-card');
    const icon = document.getElementById('server-icon');
    const label = document.getElementById('server-label');
    const detail = document.getElementById('server-detail');
    const loginBtn = document.getElementById('fyers-login-btn');
    
    icon.textContent = '⏳';
    label.textContent = 'Checking server...';
    detail.textContent = `Looking for server at ${window.location.host}`;
    
    try {
        const response = await fetch('/api/token-status', {
            method: 'GET',
            signal: AbortSignal.timeout(3000)
        });
        const data = await response.json();
        
        if (data.configured) {
            card.className = 'server-status-card online';
            icon.textContent = '✅';
            label.textContent = 'Server running & configured!';
            detail.textContent = `App ID: ${data.appId} | ${data.connected ? '🔑 Token active' : 'Ready to login'}`;
            loginBtn.disabled = false;
            loginBtn.textContent = data.connected ? '✅ Already Connected — Re-Login' : '🔑 Login with Fyers';
            
            if (data.connected) {
                showToast('Fyers server already has an active token!', 'success');
            }
        } else {
            card.className = 'server-status-card offline';
            icon.textContent = '⚠️';
            label.textContent = 'Server running but NOT configured';
            detail.textContent = 'Open fyers-server.js and add your APP_ID and SECRET_KEY';
            loginBtn.disabled = true;
        }
    } catch (e) {
        card.className = 'server-status-card offline';
        icon.textContent = '❌';
        label.textContent = 'Server not running';
        detail.textContent = 'Run "node fyers-server.js" in the project folder first';
        loginBtn.disabled = true;
    }
}

async function fyersLogin() {
    try {
        const response = await fetch('/api/login');
        const data = await response.json();
        
        if (data.error) {
            showToast(data.message || data.error, 'error');
            return;
        }
        
        if (data.authUrl) {
            showToast('Opening Fyers login page...', 'info');
            // Open Fyers login in current window (will redirect back after auth)
            window.location.href = data.authUrl;
        }
    } catch (e) {
        showToast('Cannot connect to local server. Is it running?', 'error');
    }
}

async function startFyersLiveFeed() {
    // ====== PURE FYERS MODE — NO SIMULATION ======
    isConnectedToFyers = true;
    
    // Kill any simulation that might be running
    if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
    }
    
    console.log('[Fyers] Starting live feed...');
    
    // Step 1: Check if server is running and token is valid
    let tokenOk = false;
    try {
        const statusRes = await fetch('/api/token-status');
        const statusData = await statusRes.json();
        console.log('[Fyers] Token status:', statusData);
        
        if (!statusData.configured) {
            showReloginOverlay('Server not configured. Add APP_ID and SECRET_KEY to fyers-server.js');
            return;
        }
        if (!statusData.connected) {
            showReloginOverlay();
            return;
        }
        tokenOk = true;
    } catch (e) {
        showToast('❌ Cannot reach local server. Run: node fyers-server.js', 'error');
        return;
    }
    
    if (!tokenOk) return;
    
    // Step 2: Fetch real data
    showToast('⏳ Fetching data from Fyers API...', 'info');
    const success = await fetchFyersData();
    
    if (success) {
        // NOW initialize option chain with real spot price
        chainDataCache = null; // Force regeneration with correct ATM
        initOptionChain();
        
        showToast(`✅ Fyers data loaded! NIFTY: ${formatNum(MARKET.nifty.spot)}`, 'success');
    } else {
        showReloginOverlay('Could not fetch data from Fyers. Your token may have expired.');
        return;
    }
    
    // Show market status
    updateMarketStatusBanner();
    
    const connectBtn = document.getElementById('connect-btn');
    if (connectBtn) {
        connectBtn.innerHTML = '<span class="connect-icon">✅</span> Connected';
        connectBtn.style.background = '#059669';
        connectBtn.style.borderColor = '#10b981';
    }
    
    // Render UI once with real data
    updateUI();
    
    // If market is open, poll every 60 seconds; if closed, data is already static — no polling
    if (isMarketOpen()) {
        let pollInterval = 60000; // 60 seconds (safe for Fyers rate limits)
        
        const pollFyers = async () => {
            const ok = await fetchFyersData();
            if (ok) {
                updateUI();
                pollInterval = 60000; // Reset to normal
            } else {
                // If fetch failed (possibly rate limited), back off to 60 seconds
                pollInterval = 60000;
                console.warn('[Fyers] Backing off to 60s polling due to fetch failure');
            }
            tickInterval = setTimeout(pollFyers, pollInterval);
        };
        
        tickInterval = setTimeout(pollFyers, pollInterval);
    }
    // When market is closed: data is fetched once above, stays static. No polling needed.
}

async function fetchFyersData() {
    try {
        const symbols = 'NSE:NIFTY50-INDEX,NSE:NIFTYBANK-INDEX,BSE:SENSEX-INDEX';
        const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols)}`);
        
        // Step 1: Get response as TEXT first (safe — won't crash on HTML)
        const responseText = await response.text();
        console.log('[Fyers] Raw response (first 300 chars):', responseText.substring(0, 300));
        
        // Step 2: Check if response is valid JSON
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (parseErr) {
            console.error('[Fyers] Response is NOT valid JSON. Token likely expired.');
            console.error('[Fyers] Response starts with:', responseText.substring(0, 100));
            showReloginOverlay('Response was not JSON — token likely expired.');
            return false;
        }
        
        // Step 3: Check for rate limiting (Error 1015)
        if (data.rateLimited || data.code === -429) {
            console.warn('[Fyers] Rate limited! Will retry in 30 seconds...');
            showToast('⏳ Rate limited by Fyers. Waiting 30 seconds before retry...', 'info');
            // Don't show relogin overlay — token is still valid
            return false;
        }
        
        // Step 4: Check for re-auth needed
        if (data.needsReauth || data.code === -401) {
            console.warn('[Fyers] Token expired, need re-authentication');
            showReloginOverlay();
            return false;
        }
        
        // Step 5: Check for API errors
        if (data.error) {
            console.warn('[Fyers] API error:', data.error, data.message);
            showToast(`⚠️ ${data.message || data.error}`, 'error');
            return false;
        }
        
        if (data.s === 'ok' && data.d && data.d.length > 0) {
            isFyersDataLoaded = true;
            
            data.d.forEach(quote => {
                const v = quote.v;
                const sym = quote.n || '';
                
                console.log(`[Fyers] ${sym}: LTP=${v.lp}, Open=${v.open_price}, High=${v.high_price}, Low=${v.low_price}, PrevClose=${v.prev_close_price}`);
                
                if (sym.includes('NIFTY50') || sym.includes('NIFTY 50')) {
                    MARKET.nifty.spot = v.lp;
                    MARKET.nifty.open = v.open_price || v.lp;
                    MARKET.nifty.high = v.high_price || v.lp;
                    MARKET.nifty.low = v.low_price || v.lp;
                    MARKET.nifty.prev = v.prev_close_price || v.lp;
                } else if (sym.includes('NIFTYBANK') || sym.includes('BANKNIFTY')) {
                    MARKET.banknifty.spot = v.lp;
                    MARKET.banknifty.open = v.open_price || v.lp;
                    MARKET.banknifty.high = v.high_price || v.lp;
                    MARKET.banknifty.low = v.low_price || v.lp;
                    MARKET.banknifty.prev = v.prev_close_price || v.lp;
                } else if (sym.includes('SENSEX')) {
                    MARKET.sensex.spot = v.lp;
                    MARKET.sensex.open = v.open_price || v.lp;
                    MARKET.sensex.high = v.high_price || v.lp;
                    MARKET.sensex.low = v.low_price || v.lp;
                    MARKET.sensex.prev = v.prev_close_price || v.lp;
                }
            });
            
            // Set chart data based on market status
            if (chartData.length < 5) {
                await fetchLiveChartHistory(activeIndex, activeTimeframe);
            } else if (chartData.length > 0) {
                const lastCandle = chartData[chartData.length - 1];
                const spot = MARKET[activeIndex].spot;
                if (spot > 0) {
                    lastCandle.close = spot;
                    if (spot > lastCandle.high) lastCandle.high = spot;
                    if (spot < lastCandle.low) lastCandle.low = spot;
                }
            }
            
            // Fetch live Option Chain from Fyers
            await fetchLiveOptionChain(activeIndex, document.getElementById('expiry-select')?.value || '');
            
            return true; // Success
            
        } else {
            console.warn('[Fyers] API returned error or empty data:', data.message || data.errmsg || JSON.stringify(data));
            return false;
        }
    } catch (e) {
        console.error('[Fyers] Fetch failed:', e.message);
        return false;
    }
}

async function fetchLiveOptionChain(indexName, timestamp = '') {
    const indexSymbol = indexName === 'banknifty' ? 'NSE:NIFTYBANK-INDEX' : (indexName === 'sensex' ? 'BSE:SENSEX-INDEX' : 'NSE:NIFTY50-INDEX');
    try {
        let url = `/api/optionchain?symbol=${encodeURIComponent(indexSymbol)}&strikecount=15`;
        if (timestamp && timestamp !== 'weekly' && timestamp !== 'nextweek' && timestamp !== 'monthly') {
            url += `&timestamp=${encodeURIComponent(timestamp)}`;
        }
        const ocRes = await fetch(url);
        const ocText = await ocRes.text();
        let ocData;
        try { ocData = JSON.parse(ocText); } catch(e) { return false; }
        
        if ((ocData.s === 'ok' || ocData.code === 200) && ocData.data) {
            const chainList = ocData.data.optionsChain || ocData.data || [];
            if (Array.isArray(chainList) && chainList.length > 0) {
                // Extract unique expiries from Fyers expiryData array
                const expiryList = ocData.data.expiryData || [];
                const expiries = expiryList.map(item => item.date || item.expiry || '').filter(Boolean);
                const expirySelect = document.getElementById('expiry-select');
                if (expirySelect && expiries.length > 0) {
                    const isNewSymbol = expirySelect.dataset.populated !== indexSymbol;
                    if (isNewSymbol) {
                        expirySelect.innerHTML = expiryList.map((expObj, idx) => {
                            const expDate = expObj.date || expObj.expiry;
                            const expTs = expObj.expiry || expObj.date;
                            let label = expDate;
                            if (expObj.expiry_flag === 'W' || idx === 0) label = `Weekly (${expDate})`;
                            if (expObj.expiry_flag === 'M' || idx === expiryList.length - 1) label = `Monthly (${expDate})`;
                            return `<option value="${expTs}">${label}</option>`;
                        }).join('');
                        expirySelect.dataset.populated = indexSymbol;
                    }
                }
                
                // Filter chain by selected expiry if multiple expiries exist in the payload
                let filteredList = chainList;
                
                // Map Fyers exchange data directly to chainDataCache
                const { strikes, atmStrike } = getStrikes();
                const newChainCache = strikes.map(strike => {
                    const ceItem = filteredList.find(item => Math.abs((item.strike_price || item.strikePrice || 0) - strike) < 1 && (item.option_type === 'CE' || item.optionType === 'CE' || item.option_type === 'CALL' || item.optionType === 'CALL' || item.symbol?.endsWith('CE'))) || {};
                    const peItem = filteredList.find(item => Math.abs((item.strike_price || item.strikePrice || 0) - strike) < 1 && (item.option_type === 'PE' || item.optionType === 'PE' || item.option_type === 'PUT' || item.optionType === 'PUT' || item.symbol?.endsWith('PE'))) || {};
                    
                    const defaultRow = generateOptionData(strike, atmStrike);
                    const ceLtp = ceItem.ltp !== undefined ? ceItem.ltp : (ceItem.last_price || ceItem.lp || ceItem.close_price);
                    const peLtp = peItem.ltp !== undefined ? peItem.ltp : (peItem.last_price || peItem.lp || peItem.close_price);
                    const ceOi = ceItem.oi !== undefined ? ceItem.oi : (ceItem.open_interest || ceItem.openInterest);
                    const peOi = peItem.oi !== undefined ? peItem.oi : (peItem.open_interest || peItem.openInterest);
                    const ceChg = ceItem.ltpch !== undefined ? ceItem.ltpch : (ceItem.change !== undefined ? ceItem.change : (ceItem.ch || ceItem.net_change || 0));
                    const peChg = peItem.ltpch !== undefined ? peItem.ltpch : (peItem.change !== undefined ? peItem.change : (peItem.ch || peItem.net_change || 0));
                    const ceVol = ceItem.volume !== undefined ? ceItem.volume : (ceItem.vol || ceItem.v || defaultRow.ce.vol);
                    const peVol = peItem.volume !== undefined ? peItem.volume : (peItem.vol || peItem.v || defaultRow.pe.vol);
                    
                    return {
                        strike: strike,
                        isATM: strike === atmStrike,
                        ce: {
                            ltp: ceLtp !== undefined ? parseFloat(ceLtp) : defaultRow.ce.ltp,
                            change: parseFloat(ceChg),
                            oi: ceOi !== undefined ? parseInt(ceOi, 10) : defaultRow.ce.oi,
                            oiChange: ceItem.oich !== undefined ? ceItem.oich : (ceItem.oiChange || ceItem.oi_change || 0),
                            vol: parseInt(ceVol, 10),
                            iv: defaultRow.ce.iv
                        },
                        pe: {
                            ltp: peLtp !== undefined ? parseFloat(peLtp) : defaultRow.pe.ltp,
                            change: parseFloat(peChg),
                            oi: peOi !== undefined ? parseInt(peOi, 10) : defaultRow.pe.oi,
                            oiChange: peItem.oich !== undefined ? peItem.oich : (peItem.oiChange || peItem.oi_change || 0),
                            vol: parseInt(peVol, 10),
                            iv: defaultRow.pe.iv
                        }
                    };
                });
                
                chainDataCache = newChainCache;
                console.log(`[Fyers] Live option chain loaded for ${indexSymbol} (${filteredList.length} items mapped)`);
                return true;
            }
        }
    } catch (ocErr) {
        console.warn('[Fyers] Option chain fetch error:', ocErr.message);
    }
    // If live fetch fails or returns empty, regenerate realistic chain for the currently selected index so it never gets stuck on old strikes
    console.warn(`[Fyers] Falling back to generated option chain for ${indexSymbol}`);
    chainDataCache = generateOptionChainData();
    return false;
}

function updateMarketStatusBanner() {
    const statusText = document.querySelector('.status-text');
    const statusDot = document.querySelector('.status-dot');
    
    if (isConnectedToFyers) {
        if (isMarketOpen()) {
            statusDot.className = 'status-dot live';
            statusText.textContent = 'Fyers Live';
        } else {
            statusDot.className = 'status-dot simulated'; // Yellow dot
            statusText.textContent = getMarketStatusText();
        }
    }
}

function copyRedirectUrl() {
    navigator.clipboard.writeText(window.location.origin + '/callback');
    showToast('Redirect URL copied!', 'success');
}

function showReloginOverlay(customMessage) {
    const overlay = document.getElementById('relogin-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
        // Update status bar
        const statusDot = document.querySelector('.status-dot');
        const statusText = document.querySelector('.status-text');
        if (statusDot) statusDot.className = 'status-dot disconnected';
        if (statusText) statusText.textContent = 'Token Expired';
    }
    console.error('[Fyers] RE-LOGIN REQUIRED:', customMessage || 'Token expired');
}

// ===========================
// Clock
// ===========================
function updateClock() {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    document.getElementById('market-clock').textContent = timeStr;
}

// ===========================
// Toast Notifications
// ===========================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> ${message}`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(50px)';
        toast.style.transition = 'all 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===========================
// Utility Functions
// ===========================
function formatNum(n) {
    if (typeof n !== 'number') return n;
    return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function formatCompact(n) {
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 10000000) return sign + (abs / 10000000).toFixed(1) + 'Cr';
    if (abs >= 100000) return sign + (abs / 100000).toFixed(1) + 'L';
    if (abs >= 1000) return sign + (abs / 1000).toFixed(1) + 'K';
    return sign + abs.toString();
}

function animateValue(el) {
    el.style.transition = 'none';
    el.style.textShadow = '0 0 8px currentColor';
    requestAnimationFrame(() => {
        el.style.transition = 'text-shadow 0.5s';
        el.style.textShadow = 'none';
    });
}

// Cleanup on page leave
window.addEventListener('beforeunload', () => {
    if (tickInterval) clearInterval(tickInterval);
});

// Handle resize
window.addEventListener('resize', () => {
    drawChart();
    if (document.getElementById('tab-oi-analysis').classList.contains('active')) {
        drawOIChart();
    }
});
