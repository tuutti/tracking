import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, localized, pickLanguage, strings } from '../site/i18n.js';

test('every language defines the same keys with the same types', () => {
  const [base, ...rest] = LANGUAGES.map(strings);
  for (const other of rest) {
    assert.deepEqual(Object.keys(other).sort(), Object.keys(base).sort());
    for (const k of Object.keys(base)) assert.equal(typeof other[k], typeof base[k], k);
  }
});

test('URL parameter overrides config; unknown values fall back to English', () => {
  assert.equal(pickLanguage('fi', 'en'), 'en');
  assert.equal(pickLanguage('en', null), 'en');
  assert.equal(pickLanguage('en', 'de'), 'en');
  assert.equal(pickLanguage('sv', null), 'en');
  assert.equal(pickLanguage(null, null), 'en');
  assert.equal(pickLanguage('fi', null, 'en'), 'en', 'the remembered choice beats config');
  assert.equal(pickLanguage('en', 'fi', 'en'), 'fi', 'the URL beats the remembered choice');
  assert.equal(pickLanguage('en', null, 'xx'), 'en');
});

test('config texts may be plain strings or per-language objects', () => {
  assert.equal(localized('Plain', 'en'), 'Plain');
  assert.equal(localized({ fi: 'Hei', en: 'Hi' }, 'en'), 'Hi');
  assert.equal(localized({ fi: 'Hei' }, 'en'), 'Hei');
  assert.equal(localized({ fi: 'Hei', en: 'Hi' }, 'sv'), 'Hi', 'English before the others');
  assert.equal(localized(undefined, 'fi'), '');
});
