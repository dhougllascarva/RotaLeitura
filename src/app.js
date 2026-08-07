import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc,
  getDoc,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import {
  AREAS,
  DEBUG,
  FIREBASE_CONFIG,
  SEARCH_MATCH_LIMIT,
  SEARCH_PAGE_SIZE
} from './config.js';
import { sincronizarDados } from './data-sync.js';
import { DataRepository } from './data-repository.js';
import { MapController } from './map-controller.js';
import { OfflineDatabase } from './offline-db.js';
import { tratarErroDePerfil, validarPerfilSnapshot } from './profile-access.js';
import {
  cederAoNavegador,
  debounce,
  escapeHtml,
  normalizar,
  urlSegura
} from './utils.js';

const $ = (id) => document.getElementById(id);

const elements = {
  loginTela: $('loginTela'),
  appTela: $('appTela'),
  email: $('email'),
  senha: $('senha'),
  btnLogin: $('btnLogin'),
  btnLogout: $('btnLogout'),
  btnBusca: $('btnBusca'),
  btnMapa: $('btnMapa'),
  btnExibirMapa: $('btnExibirMapa'),
  abaBusca: $('abaBusca'),
  abaMapa: $('abaMapa'),
  area: $('area'),
  areaMapa: $('areaMapa'),
  mru: $('mru'),
  mruMapa: $('mruMapa'),
  busca: $('busca'),
  listaMRUs: $('listaMRUs'),
  listaMRUsMapa: $('listaMRUsMapa'),
  resultados: $('resultados'),
  statusOfflineCard: $('statusOfflineCard'),
  offlineAviso: $('offlineAviso'),
  loadingTela: $('loadingTela'),
  loadingTexto: $('loadingTexto'),
  mapaStatus: $('mapaStatus')
};

const firebaseApp = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(firebaseApp);
const firestore = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

const offlineDb = new OfflineDatabase();
const repository = new DataRepository(offlineDb);
const mapController = new MapController('map', (text) => {
  elements.mapaStatus.textContent = text;
});

let permissoes = [];
let abaAtual = 'busca';
let pesquisaGeneration = 0;
let authGeneration = 0;
let areaGeneration = 0;
let avisoSincronizacao = '';
let ultimoResultado = { rows: [], limitado: false, visiveis: 0 };

await Promise.all([
  offlineDb.abrir(),
  setPersistence(auth, browserLocalPersistence)
]);

function mostrarLoading(texto = 'Carregando…') {
  elements.loadingTexto.textContent = texto;
  elements.loadingTela.classList.remove('oculto');
}

function atualizarLoading(texto) {
  elements.loadingTexto.textContent = texto;
}

function ocultarLoading() {
  elements.loadingTela.classList.add('oculto');
}

function mostrarErro(mensagem, erro) {
  if (DEBUG) console.error(mensagem, erro);
  const detalhe = erro?.message ? `\n\n${erro.message}` : '';
  window.alert(`${mensagem}${detalhe}`);
}

function atualizarInternet() {
  if (!navigator.onLine) {
    elements.offlineAviso.textContent = '📡 Funcionando offline';
    elements.offlineAviso.classList.remove('oculto');
    return;
  }

  if (avisoSincronizacao) {
    elements.offlineAviso.textContent = avisoSincronizacao;
    elements.offlineAviso.classList.remove('oculto');
    return;
  }

  elements.offlineAviso.textContent = '✅ Conexão restabelecida';
  elements.offlineAviso.classList.add('oculto');
}

async function obterPerfil(user) {
  const snap = await getDoc(doc(firestore, 'usuarios', user.email));
  return validarPerfilSnapshot(snap);
}

async function tratarFalhaPerfil(error, mensagemTransitoria) {
  return tratarErroDePerfil(error, {
    logout: () => signOut(auth),
    acessoNegado: (falha) => mostrarErro('Seu acesso não está mais disponível.', falha),
    falhaTransitoria: (falha) => mostrarErro(mensagemTransitoria, falha)
  });
}

async function verificarPermissaoAtual() {
  const user = auth.currentUser;
  if (!user || !navigator.onLine) return;

  try {
    await obterPerfil(user);
  } catch (error) {
    await tratarFalhaPerfil(
      error,
      'Não foi possível verificar seu acesso agora. Tente novamente quando a conexão estabilizar.'
    );
  }
}

function popularAreas() {
  const options = [
    '<option value="">Selecionar Área</option>',
    ...permissoes.map((area) => (
      `<option value="${escapeHtml(area)}">${escapeHtml(area)} - ${escapeHtml(AREAS[area] ?? area)}</option>`
    ))
  ].join('');

  elements.area.innerHTML = options;
  elements.areaMapa.innerHTML = options;

  const apenasUmaArea = permissoes.length === 1;
  elements.area.hidden = apenasUmaArea;
  elements.areaMapa.hidden = apenasUmaArea;
}

function atualizarProgressoSincronizacao({ etapa, area, parte, partes }) {
  const nomeArea = AREAS[area] ?? area;

  if (etapa === 'baixando') {
    atualizarLoading(`Baixando ${nomeArea}: arquivo ${parte}/${partes}…`);
    return;
  }

  if (etapa === 'salvando') {
    atualizarLoading(`Salvando ${nomeArea} para uso offline…`);
    return;
  }

  atualizarLoading(`Verificando ${nomeArea}…`);
}

function atualizarAvisoSincronizacao(resultado) {
  const possuiFalha = resultado.degradadas.length > 0 || resultado.indisponiveis.length > 0;
  avisoSincronizacao = possuiFalha
    ? '⚠️ Não foi possível atualizar todos os dados. Usando as bases salvas disponíveis.'
    : '';
  atualizarInternet();
}

function preencherMruLists(mrus) {
  const options = mrus
    .map((mru) => `<option value="${escapeHtml(mru)}"></option>`)
    .join('');

  elements.listaMRUs.innerHTML = options;
  elements.listaMRUsMapa.innerHTML = options;
}

async function selecionarArea(area, origem) {
  const generation = ++areaGeneration;
  pesquisaGeneration += 1;
  elements.resultados.replaceChildren();
  ultimoResultado = { rows: [], limitado: false, visiveis: 0 };
  elements.mru.value = '';
  elements.mruMapa.value = '';
  elements.busca.value = '';
  mapController.limparPontos();

  if (!area) {
    repository.liberar();
    preencherMruLists([]);
    elements.statusOfflineCard.classList.add('oculto');
    elements.area.value = '';
    elements.areaMapa.value = '';
    return;
  }

  elements.area.value = area;
  elements.areaMapa.value = area;

  try {
    mostrarLoading(`Carregando ${AREAS[area] ?? area}…`);
    const resumo = await repository.carregarArea(area);
    if (generation !== areaGeneration || !resumo) return;
    preencherMruLists(resumo.mrus);
    atualizarStatusOffline(area, resumo.total);

    try {
      localStorage.setItem('rotaleitura:lastArea', area);
    } catch {}
  } catch (error) {
    if (generation !== areaGeneration) return;
    mostrarErro('Erro ao carregar a área.', error);
    if (origem === 'busca') elements.area.value = '';
    if (origem === 'mapa') elements.areaMapa.value = '';
  } finally {
    if (generation === areaGeneration) ocultarLoading();
  }
}

function atualizarStatusOffline(area, total) {
  elements.statusOfflineCard.classList.remove('oculto');
  elements.statusOfflineCard.innerHTML = `
    <div class="statusOk">🟢 Busca offline disponível</div>
    <div style="margin-top:8px">${total.toLocaleString('pt-BR')} instalações da área ${escapeHtml(area)} estão salvas neste aparelho.</div>
    <div class="statusAlerta" style="margin-top:14px">🟡 Mapa parcialmente offline</div>
    <div style="margin-top:8px">Os tiles recentes são mantidos com limite automático para evitar travamentos e excesso de armazenamento.</div>
  `;
}

function abrirAba(tipo) {
  abaAtual = tipo;
  const mapaAtivo = tipo === 'mapa';

  elements.abaBusca.classList.toggle('oculto', mapaAtivo);
  elements.abaMapa.classList.toggle('oculto', !mapaAtivo);
  elements.btnBusca.classList.toggle('ativa', !mapaAtivo);
  elements.btnMapa.classList.toggle('ativa', mapaAtivo);

  if (mapaAtivo) {
    elements.resultados.replaceChildren();
    mapController.setVisible(true);
  } else {
    mapController.setVisible(false);
  }
}

function rowMatches(row, filtroTexto) {
  if (!filtroTexto) return true;

  // Não cria um índice textual de 110 mil strings: normaliza somente os candidatos necessários.
  return [row[1], row[2], row[3], row[4], row[5], row[6], row[7]]
    .some((value) => normalizar(value).includes(filtroTexto));
}

async function pesquisar() {
  const generation = ++pesquisaGeneration;
  const mruDigitada = elements.mru.value.trim();
  const buscaDigitada = elements.busca.value.trim();

  if (mruDigitada.length < 5 && buscaDigitada.length < 5) {
    elements.resultados.replaceChildren();
    return;
  }

  if (!repository.activeArea) {
    elements.resultados.innerHTML = '<div class="card">Selecione uma área primeiro.</div>';
    return;
  }

  const filtroTexto = normalizar(buscaDigitada);
  const candidatos = repository.candidatosPorMru(mruDigitada);
  const resultados = [];
  let processados = 0;
  let limitado = false;

  for (const row of candidatos) {
    if (generation !== pesquisaGeneration) return;

    processados += 1;
    if (rowMatches(row, filtroTexto)) {
      resultados.push(row);

      if (resultados.length >= SEARCH_MATCH_LIMIT) {
        limitado = processados < candidatos.length;
        break;
      }
    }

    if (processados % 1200 === 0) {
      await cederAoNavegador();
    }
  }

  if (generation !== pesquisaGeneration) return;
  ultimoResultado = {
    rows: resultados,
    limitado,
    visiveis: Math.min(SEARCH_PAGE_SIZE, resultados.length)
  };
  renderizarResultados();
}

function renderizarResultados() {
  const { rows, limitado, visiveis } = ultimoResultado;

  if (!rows.length) {
    elements.resultados.innerHTML = `
      <div class="contadorResultados">0 resultado(s)</div>
      <div class="card">Nenhum resultado encontrado.</div>
    `;
    return;
  }

  const exibidos = rows.slice(0, visiveis);
  const resumo = limitado
    ? `Exibindo ${exibidos.length} de pelo menos ${rows.length} resultados. Refine a busca para encontrar registros além deste limite.`
    : `Exibindo ${exibidos.length} de ${rows.length} resultado(s).`;

  const cards = exibidos.map((row) => {
    const link = urlSegura(row[10]);
    const navegar = link === '#'
      ? ''
      : `<a class="botao" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">🗺 Navegar</a>`;

    return `
      <article class="card resultado-card">
        <div class="infoTitulo">⚡ Instalação</div>
        <div class="infoValor">${escapeHtml(row[1] || '')}</div>
        <div class="infoTitulo">🔢 Medidor</div>
        <div class="infoValor">${escapeHtml(row[2] || '')}</div>
        <div class="infoTitulo">📍 Endereço</div>
        <div class="infoValor">${escapeHtml(row[3] || '')}, ${escapeHtml(row[4] || '')}</div>
        <div class="infoTitulo">🗺 Bairro</div>
        <div class="infoValor">${escapeHtml(row[5] || '')}</div>
        <div class="infoTitulo">🏙 Cidade</div>
        <div class="infoValor">${escapeHtml(row[6] || '')}</div>
        <div class="infoTitulo">👤 Cliente</div>
        <div class="infoValor">${escapeHtml(row[7] || '')}</div>
        ${navegar}
      </article>
    `;
  }).join('');

  const carregarMais = visiveis < rows.length
    ? '<button class="botao" id="btnMaisResultados" type="button">CARREGAR MAIS 100</button>'
    : '';

  elements.resultados.innerHTML = `
    <div class="contadorResultados">${escapeHtml(resumo)}</div>
    ${cards}
    ${carregarMais}
  `;
}

async function exibirMapa() {
  if (!repository.activeArea) {
    window.alert('Selecione uma área primeiro.');
    return;
  }

  const mru = elements.mruMapa.value.trim();
  const rows = repository.linhasDaMru(mru);

  if (!rows.length) {
    window.alert('Selecione uma MRU válida da lista.');
    return;
  }

  elements.btnExibirMapa.disabled = true;
  elements.mapaStatus.textContent = 'Preparando mapa…';

  try {
    await mapController.exibir(rows);
  } catch (error) {
    mostrarErro('Erro ao exibir o mapa.', error);
  } finally {
    elements.btnExibirMapa.disabled = false;
  }
}

async function fazerLogin() {
  if (auth.currentUser) {
    try {
      const generation = ++authGeneration;
      await iniciarSessao(auth.currentUser, generation);
    } catch (error) {
      if (error instanceof Error) {
        await tratarFalhaPerfil(
          error,
          'Não foi possível carregar o usuário agora. Sua autenticação foi mantida; tente novamente.'
        );
      }
    } finally {
      ocultarLoading();
    }
    return;
  }

  const email = elements.email.value.trim();
  const senha = elements.senha.value;

  if (!email || !senha) {
    window.alert('Informe o e-mail e a senha.');
    return;
  }

  try {
    mostrarLoading('Entrando…');
    await signInWithEmailAndPassword(auth, email, senha);
  } catch (error) {
    mostrarErro('Erro no login.', error);
    ocultarLoading();
  }
}

async function sair() {
  mapController.destruir();
  repository.liberar();
  await signOut(auth);
}

async function iniciarSessao(user, generation) {
  mostrarLoading('Carregando usuário…');
  const dados = await obterPerfil(user);
  if (generation !== authGeneration) return;

  permissoes = (dados.areas ?? []).map(String).filter((area) => AREAS[area]);
  if (!permissoes.length) {
    throw new Error('O usuário não possui áreas autorizadas.');
  }

  atualizarLoading('Carregando configuração…');
  const resultadoSincronizacao = await sincronizarDados({
    areas: permissoes,
    offlineDb,
    fetchFn: fetch,
    yieldFn: cederAoNavegador,
    onProgress: atualizarProgressoSincronizacao
  });
  if (generation !== authGeneration) return;

  if (DEBUG) {
    for (const [area, resultado] of Object.entries(resultadoSincronizacao.areas)) {
      if (resultado.erro) console.warn(`Sincronização da área ${area}: ${resultado.erro}`);
    }
  }

  permissoes = permissoes.filter(
    (area) => resultadoSincronizacao.areas[area]?.status !== 'indisponivel'
  );
  if (!permissoes.length) {
    throw new Error('Nenhuma área autorizada está disponível neste aparelho. Conecte-se e tente novamente.');
  }

  atualizarAvisoSincronizacao(resultadoSincronizacao);
  popularAreas();

  elements.loginTela.classList.add('oculto');
  elements.appTela.classList.remove('oculto');
  abrirAba('busca');

  let areaInicial = '';
  try {
    const anterior = localStorage.getItem('rotaleitura:lastArea');
    if (anterior && permissoes.includes(anterior)) areaInicial = anterior;
  } catch {}

  if (!areaInicial && permissoes.length === 1) areaInicial = permissoes[0];
  if (areaInicial) await selecionarArea(areaInicial, 'busca');
}

onAuthStateChanged(auth, async (user) => {
  const generation = ++authGeneration;

  if (!user) {
    permissoes = [];
    avisoSincronizacao = '';
    repository.liberar();
    mapController.destruir();
    elements.loginTela.classList.remove('oculto');
    elements.appTela.classList.add('oculto');
    elements.senha.value = '';
    atualizarInternet();
    ocultarLoading();
    return;
  }

  try {
    await iniciarSessao(user, generation);
  } catch (error) {
    if (generation !== authGeneration) return;
    await tratarFalhaPerfil(
      error,
      'Não foi possível carregar o usuário agora. Sua autenticação foi mantida; tente entrar novamente.'
    );
  } finally {
    if (generation === authGeneration) ocultarLoading();
  }
});

const pesquisarDebounced = debounce(pesquisar, 180);

elements.btnLogin.addEventListener('click', fazerLogin);
elements.btnLogout.addEventListener('click', sair);
elements.btnBusca.addEventListener('click', () => abrirAba('busca'));
elements.btnMapa.addEventListener('click', () => abrirAba('mapa'));
elements.btnExibirMapa.addEventListener('click', exibirMapa);
elements.area.addEventListener('change', () => selecionarArea(elements.area.value, 'busca'));
elements.areaMapa.addEventListener('change', () => selecionarArea(elements.areaMapa.value, 'mapa'));
elements.mru.addEventListener('input', pesquisarDebounced);
elements.busca.addEventListener('input', pesquisarDebounced);
elements.resultados.addEventListener('click', (event) => {
  if (!event.target.closest('#btnMaisResultados')) return;
  ultimoResultado.visiveis = Math.min(
    ultimoResultado.visiveis + SEARCH_PAGE_SIZE,
    ultimoResultado.rows.length
  );
  renderizarResultados();
});
elements.senha.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') fazerLogin();
});

window.addEventListener('online', () => {
  atualizarInternet();
  verificarPermissaoAtual();
});
window.addEventListener('offline', atualizarInternet);

document.addEventListener('visibilitychange', () => {
  const visivel = document.visibilityState === 'visible';
  if (abaAtual === 'mapa') mapController.setVisible(visivel, true);

  if (visivel && navigator.onLine) {
    verificarPermissaoAtual();
  }
});

if ('serviceWorker' in navigator) {
  let recarregandoParaNovoWorker = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recarregandoParaNovoWorker) return;
    recarregandoParaNovoWorker = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', {
        updateViaCache: 'none'
      });
      registration.update();
    } catch (error) {
      if (DEBUG) console.error('Erro ao registrar Service Worker:', error);
    }
  });
}

atualizarInternet();
