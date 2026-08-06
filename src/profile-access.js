export class ProfileAccessError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProfileAccessError';
  }
}

export function validarPerfilSnapshot(snapshot) {
  if (!snapshot.exists()) {
    throw new ProfileAccessError('Usuário sem permissão.');
  }

  const dados = snapshot.data();
  if (!dados.ativo) {
    throw new ProfileAccessError('Usuário desativado.');
  }

  return dados;
}

export async function tratarErroDePerfil(error, { logout, acessoNegado, falhaTransitoria }) {
  if (error instanceof ProfileAccessError) {
    acessoNegado(error);
    await logout();
    return 'acesso-negado';
  }

  falhaTransitoria(error);
  return 'falha-transitoria';
}
