import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProfileAccessError,
  tratarErroDePerfil,
  validarPerfilSnapshot
} from '../src/profile-access.js';

function snapshot(exists, data = {}) {
  return { exists: () => exists, data: () => data };
}

test('falha transitória mantém autenticação e permite informar nova tentativa', async () => {
  let logouts = 0;
  let falhas = 0;
  const resultado = await tratarErroDePerfil(new Error('unavailable'), {
    logout: async () => { logouts += 1; },
    acessoNegado: () => {},
    falhaTransitoria: () => { falhas += 1; }
  });

  assert.equal(resultado, 'falha-transitoria');
  assert.equal(logouts, 0);
  assert.equal(falhas, 1);
});

test('perfil inexistente ou inativo é uma negação comprovada e executa logout', async () => {
  for (const snap of [snapshot(false), snapshot(true, { ativo: false })]) {
    let error;
    assert.throws(() => validarPerfilSnapshot(snap), (caught) => {
      error = caught;
      return caught instanceof ProfileAccessError;
    });

    let logouts = 0;
    let negacoes = 0;
    const resultado = await tratarErroDePerfil(error, {
      logout: async () => { logouts += 1; },
      acessoNegado: () => { negacoes += 1; },
      falhaTransitoria: () => {}
    });

    assert.equal(resultado, 'acesso-negado');
    assert.equal(logouts, 1);
    assert.equal(negacoes, 1);
  }
});

test('perfil ativo preserva os campos existentes', () => {
  const dados = { ativo: true, areas: ['171'], campoExistente: 'valor' };
  assert.strictEqual(validarPerfilSnapshot(snapshot(true, dados)), dados);
});
