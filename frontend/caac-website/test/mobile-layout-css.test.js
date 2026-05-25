import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../css/common.css', import.meta.url), 'utf8');

function ruleBody(selector, source = css) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(source);
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
}

function ruleBodies(selector, source = css) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...source.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'gm'))].map((match) => match[1]);
}

function declarationValue(body, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*:\\s*([^;]+);?`).exec(body);
  return match?.[1]?.trim() ?? null;
}

function mediaBody(query) {
  const bodies = [];
  let start = css.indexOf(`@media ${query}`);

  while (start !== -1) {
    const open = css.indexOf('{', start);
    let depth = 0;
    for (let index = open; index < css.length; index += 1) {
      if (css[index] === '{') depth += 1;
      if (css[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          bodies.push(css.slice(open + 1, index));
          start = css.indexOf(`@media ${query}`, index);
          break;
        }
      }
    }

    if (depth !== 0) {
      assert.fail(`Unclosed @media ${query}`);
    }
  }

  assert.notEqual(bodies.length, 0, `Missing @media ${query}`);
  return bodies.join('\n');
}

test('admin mobile grids and monitor controls cannot force page overflow at 390px', () => {
  assert.match(ruleBody('.stats-row'), /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(ruleBody('.stat-card'), /min-width:\s*0/);
  assert.match(ruleBody('.stat-value'), /overflow-wrap:\s*anywhere/);

  const phone = mediaBody('(max-width: 520px)');
  const phoneStatsColumns = ruleBodies('.stats-row', phone)
    .map((body) => declarationValue(body, 'grid-template-columns'))
    .filter(Boolean);
  assert.notEqual(phoneStatsColumns.length, 0, 'Missing phone stats-row column rule');
  assert.equal(phoneStatsColumns.at(-1), '1fr');
  assert.match(ruleBody('.runtime-actions', phone), /grid-template-columns:\s*1fr/);
  assert.match(ruleBody('.runtime-scenario-btn', phone), /max-width:\s*100%/);
});
