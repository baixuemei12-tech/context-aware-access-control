import Chart from 'chart.js/auto';
import '../../css/dynamic-fx.css';
import '../styles/overview.css';
import config from '../../js/config.js?raw';
import common from '../../js/common.js?raw';
import visuals from '../../js/visuals.js?raw';
import overview from '../../js/overview.js?raw';
import dynamicFx from '../../js/dynamic-fx.js?raw';
import { runLegacyStack } from '../legacy/run-legacy.js';

window.Chart = Chart;

runLegacyStack([
  ['js/config.js', config],
  ['js/common.js', common],
  ['js/visuals.js', visuals],
  ['js/overview.js', overview],
  ['js/dynamic-fx.js', dynamicFx]
]);

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) entry.target.classList.add('visible');
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', event => {
    event.preventDefault();
    const target = document.querySelector(anchor.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

const progress = document.getElementById('scrollProgress');
const navLinks = [...document.querySelectorAll('.ov-nav a')];
const navTargets = navLinks.map(anchor => document.querySelector(anchor.getAttribute('href'))).filter(Boolean);

function updateScrollUi() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const ratio = max > 0 ? window.scrollY / max : 0;
  if (progress) progress.style.width = (ratio * 100).toFixed(2) + '%';
  let active = navTargets[0];
  navTargets.forEach(target => {
    if (target.getBoundingClientRect().top < window.innerHeight * 0.42) active = target;
  });
  navLinks.forEach(anchor => anchor.classList.toggle('active', active && anchor.getAttribute('href') === '#' + active.id));
}

let scrollTick = false;
function scheduleScrollUi() {
  if (scrollTick) return;
  scrollTick = true;
  requestAnimationFrame(() => {
    scrollTick = false;
    updateScrollUi();
  });
}
window.addEventListener('scroll', scheduleScrollUi, { passive: true });
window.addEventListener('resize', scheduleScrollUi);
updateScrollUi();

function renderOverviewCharts() {
  if (renderOverviewCharts.done) return;
  renderOverviewCharts.done = true;
  const fc = '#8899b4';
  const gc = 'rgba(100,160,255,.06)';
  const base = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, grid: { color: gc }, ticks: { color: fc, font: { size: 10 } } },
      x: { grid: { display: false }, ticks: { color: fc, font: { size: 9 }, maxRotation: 35 } }
    }
  };
  const lb = ['PERMIT', 'DENY', 'MIXED', 'Algo2', 'RGCA-H', 'RGCA-M', 'RGCA-L', 'Degrad.', 'Temporal', 'Burst', 'R_int', 'CSRP', 'CAAR'];
  const cl = ['#3266ad', '#5B8FD4', '#85B7EB', '#1D9E75', '#E24B4A', '#EF9F27', '#1D9E75', '#7F77DD', '#D4537E', '#5DCAA5', '#D85A30', '#7D3C98', '#2ECC71'];
  new Chart(document.getElementById('ov-tps'), { type: 'bar', data: { labels: lb, datasets: [{ data: [1461.2, 1729.0, 1785.3, 1749.3, 1848.2, 1746.8, 1772.7, 1840.2, 1950.4, 1925.3, 1773.8, 1857.5, 235.7], backgroundColor: cl, borderRadius: 4, barPercentage: 0.7 }] }, options: { ...base, scales: { ...base.scales, y: { ...base.scales.y, title: { display: true, text: 'TPS', color: fc, font: { size: 10 } } } } } });
  new Chart(document.getElementById('ov-lat'), { type: 'bar', data: { labels: lb, datasets: [{ data: [570, 190, 1090, 210, 280, 160, 500, 180, 240, 270, 220, 440, 3870], backgroundColor: cl, borderRadius: 4, barPercentage: 0.7 }] }, options: { ...base, scales: { ...base.scales, y: { ...base.scales.y, title: { display: true, text: 'max ms', color: fc, font: { size: 10 } } } } } });
  new Chart(document.getElementById('ov-sec'), { type: 'doughnut', data: { labels: ['Successful tx', 'Failed tx'], datasets: [{ data: [103000, 0.001], backgroundColor: ['#34d399', 'rgba(248,113,113,.2)'], borderColor: ['#0F6E56', 'rgba(248,113,113,.35)'], borderWidth: 1 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom', labels: { color: fc, font: { size: 11 }, padding: 16 } } }, cutout: '65%' } });
}

window.renderOverviewCharts = renderOverviewCharts;
renderOverviewCharts();
