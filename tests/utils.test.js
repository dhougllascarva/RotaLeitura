import test from 'node:test';
import assert from 'node:assert/strict';
import { coordenadaValida, escapeHtml, normalizar } from '../src/utils.js';

test('normaliza acentos, espaços e caixa', () => {
  assert.equal(normalizar('  ILHÉUS  01 '), 'ilheus01');
});

test('escapa conteúdo inserido no HTML', () => {
  assert.equal(escapeHtml('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
});

test('valida latitude e longitude', () => {
  assert.equal(coordenadaValida('-14.79', '-39.28'), true);
  assert.equal(coordenadaValida('nan', '-39.28'), false);
  assert.equal(coordenadaValida('91', '0'), false);
});
