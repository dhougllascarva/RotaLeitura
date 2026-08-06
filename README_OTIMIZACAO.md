# RotaLeitura PWA — otimização de desempenho

## Problemas encontrados na versão anterior

1. A área era lida duas vezes do IndexedDB: uma para a busca e outra para o mapa.
2. A busca criava um terceiro índice com uma grande string normalizada para cada instalação.
3. Em uma área com mais de 110 mil instalações, esse desenho podia ocupar aproximadamente 200 MB de heap JavaScript.
4. Toda pesquisa podia inserir centenas ou milhares de cards no DOM de uma vez.
5. O mapa era destruído e reconstruído em cada uso.
6. Os marcadores recebiam popup e eventos de mouse antecipadamente.
7. O clique em um agrupamento montava uma lista HTML com todos os pontos internos.
8. O Service Worker armazenava todos os tiles de mapa e satélite sem qualquer limite.
9. Os arquivos JSON grandes ficavam duplicados no IndexedDB e no Cache Storage.
10. HTML, CSS, autenticação, busca, banco offline e mapa estavam concentrados em um único arquivo.

## Estrutura atual

- `index.html`: marcação da interface.
- `assets/app.css`: estilos e otimizações de pintura.
- `src/app.js`: autenticação, fluxo da aplicação e eventos.
- `src/offline-db.js`: acesso ao IndexedDB.
- `src/data-repository.js`: uma única área ativa em memória e índice leve por MRU.
- `src/map-controller.js`: ciclo de vida do Leaflet, marcadores e GPS.
- `src/utils.js`: normalização, escape de HTML, debounce e validações.
- `src/config.js`: versões, áreas e limites.
- `sw.js`: estratégias de cache separadas e cache de tiles limitado.
- `tests/`: testes unitários sem dependências externas.

## Ganho medido com a maior área

Em uma simulação local com a área 171, contendo 110.843 instalações:

- desenho anterior simulado: cerca de **199,9 MB** de heap;
- novo repositório: cerca de **59,1 MB** de heap;
- criação do índice por MRU: aproximadamente **40 ms** no ambiente de teste.

A medição representa o custo das estruturas JavaScript, não o consumo total do navegador.

## Alterações principais

### Dados e busca

- Busca e mapa compartilham a mesma referência da área.
- Não existe mais `bancoBuscaIndexado` com 110 mil textos concatenados.
- A MRU exata consulta diretamente um `Map` em vez de filtrar toda a área.
- A pesquisa cede tempo ao navegador a cada lote para evitar a mensagem de página sem resposta.
- São mantidos no máximo 1.000 resultados por busca e renderizados 100 por vez.
- Os cards fora da tela usam `content-visibility: auto`.

### Mapa

- Uma instância do Leaflet é reutilizada.
- As camadas de pontos são removidas ao sair da aba do mapa.
- O GPS é interrompido quando a aba ou o PWA fica oculto.
- Atualizações de localização com deslocamento inferior a 3 metros em menos de 5 segundos são ignoradas.
- Os marcadores são adicionados em lote com `chunkedLoading`.
- Popups são criados somente quando o ponto é aberto.
- O agrupamento usa o comportamento nativo de zoom, sem criar listas enormes no clique.
- Os tiles usam `updateWhenIdle`, `updateWhenZooming: false` e `keepBuffer: 1`.

### Service Worker

- Arquivos estáticos, recursos externos, mapa e satélite usam caches separados.
- JSONs de área não são duplicados no Cache Storage.
- Cache máximo: 500 tiles do OpenStreetMap e 250 tiles de satélite.
- A limpeza ocorre em lotes, evitando chamar `cache.keys()` para cada tile.

## Validação no Codespace

```bash
npm test
npm run check
python3 -m http.server 8080
```

Abra a porta 8080 pelo painel **Ports** do Codespace.

## Teste manual recomendado

1. Fazer login e selecionar a área 171 ou 173.
2. Buscar uma MRU e carregar mais de uma página de resultados.
3. Abrir o mapa de uma MRU com muitos pontos.
4. Alternar mapa/satélite, aplicar zoom e arrastar por alguns minutos.
5. Trocar dez vezes entre as abas Busca e Mapa.
6. Ocultar e reabrir o PWA, verificando se o GPS volta apenas na aba Mapa.
7. No DevTools, acompanhar **Performance**, **Memory**, **Application > Cache Storage** e **IndexedDB**.
8. Confirmar que os caches de tiles não crescem indefinidamente.

## Observação

O cache limitado de tiles evita o travamento, mas não equivale a um pacote completo de mapas offline. Para mapas offline garantidos por área, o ideal é adotar arquivos vetoriais/MBTiles próprios ou um provedor com licença adequada, em uma etapa separada.
