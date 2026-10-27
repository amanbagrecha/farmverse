// Stepped loading card: shows what is being fetched, step by step, with readable errors and a retry.
import { $, h } from './util.js';

export function createLoader() {
  const root = $('loading'), list = $('loading-steps'), sub = $('loading-sub'), err = $('loading-err'), act = $('loading-act');
  const items = {};
  function start(title, steps) {
    root.classList.remove('hidden'); root.querySelector('.lt').textContent = 'FARMVERSE';
    sub.textContent = title; list.textContent = ''; err.classList.add('hidden'); act.textContent = '';
    for (const [id, label] of steps) { const li = h('li', {}, h('i', { text: '·' }), h('div', {}, h('span', { text: label }), h('small'))); items[id] = li; list.append(li); }
  }
  function step(id, status, detail) {
    const li = items[id]; if (!li) return;
    li.className = status;
    li.querySelector('i').textContent = { work: '▸', done: '✓', skip: '–', fail: '✕' }[status] || '·';
    li.querySelector('small').textContent = detail || '';
  }
  function fail(message, actions = []) {
    err.textContent = message; err.classList.remove('hidden'); act.textContent = '';
    for (const [label, run, primary] of actions) act.append(h('button', { class: 'btn' + (primary ? ' primary' : ''), text: label, onclick: run }));
  }
  function done() { root.classList.add('hidden'); }
  return { start, step, fail, done, isOpen: () => !root.classList.contains('hidden') };
}
