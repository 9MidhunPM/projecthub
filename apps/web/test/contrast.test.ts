import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]+;/g, '');

// These checks inspect declared opaque source pairs, not computed browser styles.
// Exact selectors and explicit inheritance/background sources keep the scope
// narrow; this is not a substitute for a browser accessibility audit.
function declarations(selector: string) {
  const result: Record<string, string> = {};
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!match[1].split(',').some(value => value.trim() === selector)) continue;
    for (const declaration of match[2].split(';')) {
      const colon = declaration.indexOf(':');
      if (colon > 0) result[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
    }
  }
  return result;
}
const tokens = declarations(':root');

function color(selector: string, property = 'color'): string {
  const value = declarations(selector)[property];
  assert.ok(value, `Missing ${property} for ${selector}`);
  const token = value.match(/(?:var\((--[\w-]+)\)|(#(?:[\da-f]{6}|[\da-f]{3}))|(white|black))\s*(?:!important)?$/i);
  assert.ok(token, `Unsupported or non-opaque color in ${selector}: ${value}`);
  const resolved = token[1] ? tokens[token[1]] : token[2] || token[3];
  assert.ok(resolved, `Missing color token ${token[1]}`);
  return resolved === 'white' ? '#ffffff' : resolved === 'black' ? '#000000' : resolved;
}

function luminance(hex: string) {
  assert.match(hex, /^#(?:[\da-f]{6}|[\da-f]{3})$/i);
  const expanded = hex.length === 4 ? [...hex.slice(1)].map(value => value + value).join('') : hex.slice(1);
  const channels = [0, 2, 4].map(index => parseInt(expanded.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function ratio(foreground: string, background: string) {
  const [dark, light] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (light + 0.05) / (dark + 0.05);
}
function meets(foreground: string, background: string, minimum: number, description: string) {
  const contrast = ratio(foreground, background);
  assert.ok(contrast >= minimum, `${description}: ${foreground} on ${background} is ${contrast.toFixed(4)}:1; needs ${minimum}:1`);
}

// WCAG 2.2 SC 1.4.3: ordinary text needs >=4.5:1, without rounding up.
// https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
test('small metadata and instruction text meets 4.5:1 on its declared surface', () => {
  const pairs = [
    ['.card-department', '.project-card', '9–10px department'],
    ['.card-department>span', '.project-card', '9–10px semester'],
    ['.cover-empty small', '.cover-empty', '10px screenshot fallback hint'],
    ['.cover-empty span', '.cover-empty', '11px table-thumbnail fallback title'],
    ['.table-project small', ':root', '10px workspace technologies'],
    ['.table-date', ':root', '11px updated date'],
    ['.back-link', ':root', '12px back navigation'],
    ['.detail-meta', ':root', '10–12px project metadata'],
    ['.review-note', '.review-note', '12px review instructions and feedback'],
    ['.upload-area', ':root', '10px inherited upload format/size hint'],
    ['.user-department', ':root', '12px account department'],
    ['.tags span', '.tags span', '10–11px technology chips'],
    ['.review-description', ':root', '13px review description'],
    ['.rail-note', '.filter-rail', '11px gallery side note'],
    ['.footer', ':root', '10–11px footer copy'],
    ['.auth-story p', '.auth-story', '15px auth subtitle (title has its own override)'],
    ['.auth-story-bottom', '.auth-story', '13px auth panel footer'],
  ];
  for (const [foreground, background, usage] of pairs) meets(color(foreground), color(background, 'background'), 4.5, `${foreground}: ${usage}`);
});

test('small status and feedback text retains semantic colors with 4.5:1 contrast', () => {
  for (const selector of ['.status', '.status-approved', '.status-pending', '.status-changes_requested', '.status-hidden']) {
    meets(color(selector), color(selector, 'background'), 4.5, `${selector}: 10px status text`);
  }
  meets(color('.feedback-small'), color(':root', 'background'), 4.5, '11px workspace feedback');
});

// SC 1.4.11 uses >=3:1 for author-provided focus indicators against adjacent
// backgrounds. Text contrast and focus-indicator contrast are separate tests.
// https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
test('custom focus rings meet 3:1 on light surfaces and the navy toast', () => {
  for (const selector of ['button:focus-visible', 'a:focus-visible', '.upload-area:focus-within', '.focus-target:focus-visible']) {
    for (const surface of [':root', '.filter-rail', '.cover-empty', '.toast']) {
      meets(color(selector, 'outline'), color(surface, 'background'), 3, `${selector} on ${surface}`);
    }
  }
});

test('primary buttons and toast messages retain sufficient text contrast', () => {
  meets(color('.button.primary'), color('.button.primary', 'background'), 4.5, '13px primary button text');
  meets(color('.toast'), color('.toast', 'background'), 4.5, '13px toast text');
});

test('reduced-motion overrides still disable declared animations and transitions', () => {
  const rule = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\*\s*\{([^}]*)\}/);
  assert.ok(rule, 'Missing existing reduced-motion preference rule');
  for (const declaration of ['transition:none!important', 'animation:none!important', 'scroll-behavior:auto!important']) {
    assert.ok(rule[1].replace(/\s/g, '').includes(declaration), `Missing reduced-motion ${declaration}`);
  }
});

test('contrast arithmetic preserves WCAG thresholds without rounding up', () => {
  assert.equal(ratio('#000000', '#ffffff'), 21);
  assert.equal(ratio('#ffffff', '#ffffff'), 1);
  assert.ok(ratio('#62718a', '#f0f3f8') < 4.5, 'The former 4.444:1 technology-chip pair must fail');
});
