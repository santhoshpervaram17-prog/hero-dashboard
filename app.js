// ===========================
// Hero Strike - Interactive Logic
// ===========================

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initStrategyCards();
    initStrategyFilters();
    initSimulator();
    initRadioOptions();
    initPnlCharts();
    animateOnScroll();
});

// ===========================
// Navigation
// ===========================
function initNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('section[id], header[id]');

    window.addEventListener('scroll', () => {
        let current = '';
        sections.forEach(section => {
            const sectionTop = section.offsetTop - 120;
            if (window.scrollY >= sectionTop) {
                current = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === '#' + current) {
                link.classList.add('active');
            }
        });
    });

    // Smooth scroll for nav links
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.querySelector(link.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });
}

// ===========================
// Strategy Cards (Expand/Collapse)
// ===========================
function initStrategyCards() {
    const cards = document.querySelectorAll('.strategy-card');
    cards.forEach(card => {
        const header = card.querySelector('.strategy-header');
        header.addEventListener('click', () => {
            const wasExpanded = card.classList.contains('expanded');
            // Collapse all
            cards.forEach(c => c.classList.remove('expanded'));
            // Toggle current
            if (!wasExpanded) {
                card.classList.add('expanded');
                // Draw chart for this strategy
                const strategy = card.dataset.strategy;
                setTimeout(() => drawStrategyChart(strategy), 100);
            }
        });
    });
}

// ===========================
// Strategy Filters
// ===========================
function initStrategyFilters() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    const cards = document.querySelectorAll('.strategy-card');

    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const filter = btn.dataset.filter;
            cards.forEach(card => {
                if (filter === 'all') {
                    card.classList.remove('hidden');
                } else {
                    const categories = card.dataset.category.split(' ');
                    if (categories.includes(filter)) {
                        card.classList.remove('hidden');
                    } else {
                        card.classList.add('hidden');
                    }
                }
            });
        });
    });
}

// ===========================
// Radio Options
// ===========================
function initRadioOptions() {
    const radioOptions = document.querySelectorAll('.radio-option');
    radioOptions.forEach(opt => {
        opt.addEventListener('click', () => {
            const group = opt.closest('.radio-group');
            group.querySelectorAll('.radio-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');

            // Update lot size based on index
            const index = opt.querySelector('input').value;
            const lotSizeInput = document.getElementById('lot-size');
            const spotInput = document.getElementById('spot-price');
            
            if (index === 'nifty') {
                lotSizeInput.value = 25;
                spotInput.value = 24700;
            } else if (index === 'banknifty') {
                lotSizeInput.value = 15;
                spotInput.value = 52000;
            } else if (index === 'sensex') {
                lotSizeInput.value = 10;
                spotInput.value = 81000;
            }
        });
    });
}

// ===========================
// P&L Simulator
// ===========================
function initSimulator() {
    const calculateBtn = document.getElementById('calculate-btn');
    calculateBtn.addEventListener('click', calculatePnL);
    
    // Initial calculation
    calculatePnL();
}

function calculatePnL() {
    const spot = parseFloat(document.getElementById('spot-price').value);
    const strategy = document.getElementById('strategy-select').value;
    const lotSize = parseInt(document.getElementById('lot-size').value);
    const numLots = parseInt(document.getElementById('num-lots').value);
    const cePremium = parseFloat(document.getElementById('ce-premium').value);
    const pePremium = parseFloat(document.getElementById('pe-premium').value);
    const spreadWidth = parseFloat(document.getElementById('spread-width').value);
    const totalQty = lotSize * numLots;

    // Strategy name mapping
    const strategyNames = {
        'straddle': 'Long Straddle',
        'strangle': 'Long Strangle',
        'bullcall': 'Bull Call Spread',
        'bearput': 'Bear Put Spread',
        'ironcondor': 'Iron Condor',
        'ironbutterfly': 'Iron Butterfly',
        'ratio': 'Ratio Call Backspread',
        'hedged': 'Hedged Straddle'
    };

    document.getElementById('result-strategy-name').textContent = strategyNames[strategy] || strategy;

    // Calculate P&L for different scenarios
    const scenarios = generateScenarios(spot, strategy, cePremium, pePremium, spreadWidth, totalQty);
    
    renderScenarios(scenarios);
    drawPayoffChart(spot, strategy, cePremium, pePremium, spreadWidth, totalQty);
    renderKeyMetrics(scenarios, strategy, cePremium, pePremium, spreadWidth, totalQty);
}

function generateScenarios(spot, strategy, cePrem, pePrem, spread, qty) {
    const moves = [-500, -300, -200, -100, 0, 100, 200, 300, 500];
    const scenarios = [];

    moves.forEach(move => {
        const expiry = spot + move;
        const pnl = calculateStrategyPnL(strategy, spot, expiry, cePrem, pePrem, spread, qty);
        scenarios.push({
            move: move,
            expiry: expiry,
            pnl: pnl,
            label: move === 0 ? 'AT MONEY' : (move > 0 ? `+${move} pts` : `${move} pts`)
        });
    });

    return scenarios;
}

function calculateStrategyPnL(strategy, spot, expiry, cePrem, pePrem, spread, qty) {
    const ceStrike = spot;
    const peStrike = spot;
    
    switch(strategy) {
        case 'straddle': {
            // Buy ATM CE + Buy ATM PE
            const cePayoff = Math.max(0, expiry - ceStrike) - cePrem;
            const pePayoff = Math.max(0, peStrike - expiry) - pePrem;
            return (cePayoff + pePayoff) * qty;
        }
        
        case 'strangle': {
            // Buy OTM CE (spot + spread/2) + Buy OTM PE (spot - spread/2)
            const otmCeStrike = spot + spread / 2;
            const otmPeStrike = spot - spread / 2;
            const otmCePrem = cePrem * 0.4; // OTM is cheaper
            const otmPePrem = pePrem * 0.4;
            const cePayoff = Math.max(0, expiry - otmCeStrike) - otmCePrem;
            const pePayoff = Math.max(0, otmPeStrike - expiry) - otmPePrem;
            return (cePayoff + pePayoff) * qty;
        }
        
        case 'bullcall': {
            // Buy ATM CE - Sell ATM+spread CE
            const sellStrike = spot + spread;
            const sellPrem = cePrem * 0.3;
            const netDebit = cePrem - sellPrem;
            const buyPayoff = Math.max(0, expiry - ceStrike);
            const sellPayoff = -Math.max(0, expiry - sellStrike);
            return (buyPayoff + sellPayoff - netDebit) * qty;
        }
        
        case 'bearput': {
            // Buy ATM PE - Sell ATM-spread PE
            const sellStrike = spot - spread;
            const sellPrem = pePrem * 0.3;
            const netDebit = pePrem - sellPrem;
            const buyPayoff = Math.max(0, peStrike - expiry);
            const sellPayoff = -Math.max(0, sellStrike - expiry);
            return (buyPayoff + sellPayoff - netDebit) * qty;
        }
        
        case 'ironcondor': {
            // Sell OTM CE & PE, Buy further OTM CE & PE
            const sellCeStrike = spot + spread;
            const buyCeStrike = spot + spread + 100;
            const sellPeStrike = spot - spread;
            const buyPeStrike = spot - spread - 100;
            
            const premReceived = (cePrem * 0.25 + pePrem * 0.25);
            const premPaid = (cePrem * 0.1 + pePrem * 0.1);
            const netCredit = premReceived - premPaid;
            
            let pnl = netCredit;
            if (expiry > sellCeStrike) {
                pnl -= Math.min(expiry - sellCeStrike, buyCeStrike - sellCeStrike);
            }
            if (expiry < sellPeStrike) {
                pnl -= Math.min(sellPeStrike - expiry, sellPeStrike - buyPeStrike);
            }
            return pnl * qty;
        }
        
        case 'ironbutterfly': {
            // Sell ATM CE & PE, Buy OTM CE & PE
            const buyCeStrike = spot + spread;
            const buyPeStrike = spot - spread;
            
            const netCredit = cePrem + pePrem - (cePrem * 0.25 + pePrem * 0.25);
            
            let pnl = netCredit;
            if (expiry > ceStrike) {
                const ceLoss = Math.min(expiry - ceStrike, buyCeStrike - ceStrike);
                pnl -= ceLoss;
            }
            if (expiry < peStrike) {
                const peLoss = Math.min(peStrike - expiry, peStrike - buyPeStrike);
                pnl -= peLoss;
            }
            return pnl * qty;
        }
        
        case 'ratio': {
            // Sell 1 ATM CE, Buy 2 OTM CE
            const otmStrike = spot + spread / 2;
            const otmPrem = cePrem * 0.35;
            const netCost = 2 * otmPrem - cePrem; // Usually small credit
            
            const sellPayoff = -Math.max(0, expiry - ceStrike);
            const buyPayoff = 2 * Math.max(0, expiry - otmStrike);
            
            return (sellPayoff + buyPayoff + cePrem - 2 * otmPrem) * qty;
        }
        
        case 'hedged': {
            // Buy ATM CE + PE, Sell OTM CE + PE (Hedged Straddle)
            const sellCeStrike = spot + spread;
            const sellPeStrike = spot - spread;
            const sellCePrem = cePrem * 0.25;
            const sellPePrem = pePrem * 0.25;
            
            const netDebit = (cePrem + pePrem) - (sellCePrem + sellPePrem);
            
            // CE side
            let cePayoff = Math.max(0, expiry - ceStrike) - Math.max(0, expiry - sellCeStrike);
            // PE side
            let pePayoff = Math.max(0, peStrike - expiry) - Math.max(0, sellPeStrike - expiry);
            
            return (cePayoff + pePayoff - netDebit) * qty;
        }
        
        default:
            return 0;
    }
}

function renderScenarios(scenarios) {
    const grid = document.getElementById('scenario-grid');
    grid.innerHTML = scenarios.map(s => {
        const isProfit = s.pnl >= 0;
        const formattedPnl = s.pnl >= 0 ? `+₹${Math.round(s.pnl).toLocaleString('en-IN')}` : `-₹${Math.abs(Math.round(s.pnl)).toLocaleString('en-IN')}`;
        return `
            <div class="scenario-card ${isProfit ? 'profit-scenario' : 'loss-scenario'}">
                <div class="scenario-label">${s.label}</div>
                <div class="scenario-move">${s.expiry.toLocaleString('en-IN')}</div>
                <div class="scenario-pnl ${isProfit ? 'positive' : 'negative'}">${formattedPnl}</div>
            </div>
        `;
    }).join('');
}

function renderKeyMetrics(scenarios, strategy, cePrem, pePrem, spread, qty) {
    const maxProfit = Math.max(...scenarios.map(s => s.pnl));
    const maxLoss = Math.min(...scenarios.map(s => s.pnl));
    const profitScenarios = scenarios.filter(s => s.pnl > 0).length;
    const winRate = Math.round((profitScenarios / scenarios.length) * 100);
    
    const metricsGrid = document.getElementById('key-metrics');
    metricsGrid.innerHTML = `
        <div class="metric-card">
            <div class="metric-label">Max Profit (in range)</div>
            <div class="metric-value green">+₹${Math.round(maxProfit).toLocaleString('en-IN')}</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Max Loss (in range)</div>
            <div class="metric-value red">-₹${Math.abs(Math.round(maxLoss)).toLocaleString('en-IN')}</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Win Rate (scenarios)</div>
            <div class="metric-value blue">${winRate}%</div>
        </div>
    `;
}

// ===========================
// Payoff Chart (Canvas)
// ===========================
function drawPayoffChart(spot, strategy, cePrem, pePrem, spread, qty) {
    const canvas = document.getElementById('pnl-canvas');
    const ctx = canvas.getContext('2d');
    
    // Set actual dimensions
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const w = rect.width;
    const h = rect.height;
    const padding = { top: 30, right: 40, bottom: 40, left: 70 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;
    
    // Generate data points
    const range = 600;
    const points = [];
    for (let move = -range; move <= range; move += 5) {
        const expiry = spot + move;
        const pnl = calculateStrategyPnL(strategy, spot, expiry, cePrem, pePrem, spread, qty);
        points.push({ x: expiry, y: pnl });
    }
    
    const minX = spot - range;
    const maxX = spot + range;
    const maxY = Math.max(...points.map(p => p.y), 1);
    const minY = Math.min(...points.map(p => p.y), -1);
    const yRange = maxY - minY || 1;
    
    // Clear
    ctx.clearRect(0, 0, w, h);
    
    // Background
    ctx.fillStyle = '#12131a';
    ctx.fillRect(0, 0, w, h);
    
    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    
    for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartH / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.stroke();
    }
    
    // Zero line
    const zeroY = padding.top + chartH * (maxY / yRange);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left, zeroY);
    ctx.lineTo(w - padding.right, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Zero label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('₹0', padding.left - 8, zeroY + 4);
    
    // Spot line (vertical)
    const spotX = padding.left + chartW * 0.5;
    ctx.strokeStyle = 'rgba(68, 138, 255, 0.3)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(spotX, padding.top);
    ctx.lineTo(spotX, h - padding.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    
    ctx.fillStyle = 'rgba(68, 138, 255, 0.6)';
    ctx.textAlign = 'center';
    ctx.fillText(spot.toLocaleString('en-IN'), spotX, h - padding.bottom + 16);
    ctx.fillText('SPOT', spotX, h - padding.bottom + 28);
    
    // Draw profit area
    ctx.beginPath();
    let started = false;
    points.forEach((p, i) => {
        const x = padding.left + ((p.x - minX) / (maxX - minX)) * chartW;
        const y = padding.top + ((maxY - p.y) / yRange) * chartH;
        if (!started) {
            ctx.moveTo(x, y);
            started = true;
        } else {
            ctx.lineTo(x, y);
        }
    });
    
    // Close for fill
    const lastPoint = points[points.length - 1];
    const lastX = padding.left + ((lastPoint.x - minX) / (maxX - minX)) * chartW;
    ctx.lineTo(lastX, zeroY);
    const firstPoint = points[0];
    const firstX = padding.left + ((firstPoint.x - minX) / (maxX - minX)) * chartW;
    ctx.lineTo(firstX, zeroY);
    ctx.closePath();
    
    // Gradient fill
    const gradFill = ctx.createLinearGradient(0, padding.top, 0, h - padding.bottom);
    gradFill.addColorStop(0, 'rgba(0, 230, 118, 0.12)');
    gradFill.addColorStop(0.5, 'rgba(0, 230, 118, 0.02)');
    gradFill.addColorStop(0.5, 'rgba(255, 82, 82, 0.02)');
    gradFill.addColorStop(1, 'rgba(255, 82, 82, 0.12)');
    ctx.fillStyle = gradFill;
    ctx.fill();
    
    // Draw the P&L line
    ctx.beginPath();
    started = false;
    points.forEach((p) => {
        const x = padding.left + ((p.x - minX) / (maxX - minX)) * chartW;
        const y = padding.top + ((maxY - p.y) / yRange) * chartH;
        if (!started) {
            ctx.moveTo(x, y);
            started = true;
        } else {
            ctx.lineTo(x, y);
        }
    });
    
    // Gradient stroke
    const grad = ctx.createLinearGradient(padding.left, 0, w - padding.right, 0);
    grad.addColorStop(0, '#ff5252');
    grad.addColorStop(0.3, '#ff9100');
    grad.addColorStop(0.5, '#448aff');
    grad.addColorStop(0.7, '#00e676');
    grad.addColorStop(1, '#00e676');
    
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    
    // Y-axis labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    
    for (let i = 0; i <= 4; i++) {
        const val = maxY - (yRange / 4) * i;
        const y = padding.top + (chartH / 4) * i;
        const label = val >= 0 ? `+₹${Math.round(val).toLocaleString('en-IN')}` : `-₹${Math.abs(Math.round(val)).toLocaleString('en-IN')}`;
        ctx.fillText(label, padding.left - 8, y + 4);
    }
    
    // X-axis labels
    ctx.textAlign = 'center';
    const xLabels = 5;
    for (let i = 0; i <= xLabels; i++) {
        const val = minX + ((maxX - minX) / xLabels) * i;
        const x = padding.left + (chartW / xLabels) * i;
        ctx.fillText(Math.round(val).toLocaleString('en-IN'), x, h - padding.bottom + 16);
    }
    
    // Legend
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Profit Zone', padding.left + 10, padding.top + 16);
    ctx.fillStyle = 'rgba(0, 230, 118, 0.5)';
    ctx.fillRect(padding.left + 80, padding.top + 8, 12, 12);
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillText('Loss Zone', padding.left + 110, padding.top + 16);
    ctx.fillStyle = 'rgba(255, 82, 82, 0.5)';
    ctx.fillRect(padding.left + 175, padding.top + 8, 12, 12);
}

// ===========================
// Mini Strategy Charts (SVG-based)
// ===========================
function initPnlCharts() {
    // Draw charts when cards expand
}

function drawStrategyChart(strategy) {
    const container = document.getElementById(`chart-${strategy}`);
    if (!container) return;
    
    const w = container.offsetWidth || 500;
    const h = 120;
    
    // Generate data
    const points = [];
    for (let x = -100; x <= 100; x += 2) {
        let y = 0;
        switch(strategy) {
            case 'straddle':
                y = Math.abs(x) - 40;
                break;
            case 'strangle':
                if (x < -30) y = (-x - 30) - 20;
                else if (x > 30) y = (x - 30) - 20;
                else y = -20;
                break;
            case 'bullcall':
                if (x < 0) y = -20;
                else if (x < 50) y = x * 0.8 - 20;
                else y = 20;
                break;
            case 'bearput':
                if (x > 0) y = -20;
                else if (x > -50) y = -x * 0.8 - 20;
                else y = 20;
                break;
            case 'ironcondor':
                if (x < -40) y = -Math.min((-x - 40) * 0.5, 30);
                else if (x > 40) y = -Math.min((x - 40) * 0.5, 30);
                else y = 15;
                break;
            case 'ironbutterfly':
                if (x < -50) y = -20;
                else if (x < 0) y = (50 + x) * 0.8 - 20;
                else if (x < 50) y = (50 - x) * 0.8 - 20;
                else y = -20;
                break;
            case 'ratio':
                if (x < 0) y = Math.max(-10, x * 0.1);
                else if (x < 30) y = -(x * 0.5);
                else y = (x - 30) * 0.5 - 15;
                break;
            case 'hedged':
            case 'hedged-straddle':
                if (x < -50) y = 20;
                else if (x < -20) y = (-x - 20) * 0.7 - 15;
                else if (x < 20) y = -15;
                else if (x < 50) y = (x - 20) * 0.7 - 15;
                else y = 20;
                break;
            case 'jade':
                if (x < -50) y = -((-x - 50) * 0.5);
                else if (x < 40) y = 20;
                else if (x < 60) y = 20 - (x - 40);
                else y = 0;
                break;
            case 'calendar':
                y = 20 * Math.exp(-(x * x) / 800) - 10;
                break;
        }
        points.push({ x, y });
    }
    
    const minY = Math.min(...points.map(p => p.y));
    const maxY = Math.max(...points.map(p => p.y));
    const yRange = maxY - minY || 1;
    
    // Create SVG path
    const pathData = points.map((p, i) => {
        const px = ((p.x + 100) / 200) * w;
        const py = h - ((p.y - minY) / yRange) * (h - 20) - 10;
        return `${i === 0 ? 'M' : 'L'} ${px} ${py}`;
    }).join(' ');
    
    // Zero line Y
    const zeroY = h - ((0 - minY) / yRange) * (h - 20) - 10;
    
    // Fill path (closed)
    const firstPx = ((points[0].x + 100) / 200) * w;
    const lastPx = ((points[points.length - 1].x + 100) / 200) * w;
    const fillPath = `${pathData} L ${lastPx} ${zeroY} L ${firstPx} ${zeroY} Z`;
    
    container.innerHTML = `
        <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;">
            <defs>
                <linearGradient id="lineGrad-${strategy}" x1="0" y1="0" x2="${w}" y2="0" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stop-color="#ff5252"/>
                    <stop offset="30%" stop-color="#ff9100"/>
                    <stop offset="50%" stop-color="#448aff"/>
                    <stop offset="70%" stop-color="#00e676"/>
                    <stop offset="100%" stop-color="#00e676"/>
                </linearGradient>
                <linearGradient id="fillGrad-${strategy}" x1="0" y1="0" x2="0" y2="${h}" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stop-color="rgba(0,230,118,0.15)"/>
                    <stop offset="50%" stop-color="rgba(0,0,0,0)"/>
                    <stop offset="100%" stop-color="rgba(255,82,82,0.15)"/>
                </linearGradient>
            </defs>
            <line x1="0" y1="${zeroY}" x2="${w}" y2="${zeroY}" stroke="rgba(255,255,255,0.1)" stroke-dasharray="4 4"/>
            <path d="${fillPath}" fill="url(#fillGrad-${strategy})" opacity="0.5"/>
            <path d="${pathData}" fill="none" stroke="url(#lineGrad-${strategy})" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            <text x="10" y="14" fill="rgba(255,255,255,0.3)" font-size="10" font-family="JetBrains Mono, monospace">P&L</text>
            <text x="${w - 10}" y="${zeroY - 5}" fill="rgba(255,255,255,0.3)" font-size="10" font-family="JetBrains Mono, monospace" text-anchor="end">₹0</text>
        </svg>
    `;
}

// ===========================
// Scroll Animations
// ===========================
function animateOnScroll() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.1 });

    // Animate various elements
    const elements = document.querySelectorAll(
        '.concept-card, .mistake-card, .strategy-card, .playbook-step, .index-card, .risk-rule, .stat-card'
    );
    
    elements.forEach((el, i) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = `all 0.6s ease-out ${(i % 6) * 0.1}s`;
        observer.observe(el);
    });
}

// ===========================
// Handle window resize for chart
// ===========================
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        // Recalculate if simulator is visible
        const canvas = document.getElementById('pnl-canvas');
        if (canvas && canvas.offsetParent !== null) {
            calculatePnL();
        }
    }, 250);
});
