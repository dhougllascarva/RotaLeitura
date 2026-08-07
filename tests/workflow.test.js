import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(
  new URL('../.github/workflows/processar.yml', import.meta.url),
  'utf8'
);

test('workflow usa o CSV novo e começa sempre em modo de validação', () => {
  assert.match(workflow, /default: validar/);
  assert.match(workflow, /- validar\s+- publicar/);
  assert.match(workflow, /1Rsv9W12zcSmrAjR2qGsp-_TZTYtSfa1M/);
  assert.match(workflow, /--fail --location/);
  assert.match(workflow, /--retry 5/);
  assert.match(workflow, /--connect-timeout 20 --max-time 600/);
  assert.match(workflow, /--check-header --input/);
});

test('validação não possui permissão de escrita e publicação exige confirmação', () => {
  const validationJob = workflow.slice(workflow.indexOf('  validar:'), workflow.indexOf('  publicar:'));
  const publicationJob = workflow.slice(workflow.indexOf('  publicar:'));

  assert.match(validationJob, /contents: read/);
  assert.doesNotMatch(validationJob, /contents: write/);
  assert.match(publicationJob, /contents: write/);
  assert.match(publicationJob, /CONFIRMACAO.*inputs\.confirmacao/);
  assert.match(publicationJob, /'ATUALIZAR'/);
  assert.match(publicationJob, /ACEITAR_REDUCAO/);
});

test('publicação limita staging aos dados e envia para a branch de origem sem força', () => {
  assert.doesNotMatch(workflow, /git add (?:\.|\*\.json)/);
  assert.match(workflow, /git add -A -- ':\(glob\)\[0-9\]\*_\[0-9\]\*\.json' indexes\.json data-manifest\.json/);
  assert.match(workflow, /git diff --cached --name-only/);
  assert.match(workflow, /git diff --cached --quiet/);
  assert.match(workflow, /git push origin "HEAD:\$\{BRANCH_NAME\}"/);
  assert.doesNotMatch(workflow, /git push[^\n]*--force/);
});
