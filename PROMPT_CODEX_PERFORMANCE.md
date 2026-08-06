# Prompt para continuar no Codex do Codespace

Analise o projeto RotaLeitura PWA na branch atual. A versão 2.0 já separa HTML, CSS, dados, IndexedDB, mapa e Service Worker. Preserve Firebase Auth, permissões do Firestore, dados offline existentes, formato dos JSONs e funcionamento no GitHub Pages.

Execute primeiro:

```bash
npm test
npm run check
```

Depois faça uma auditoria conservadora, sem reescrever a aplicação em framework e sem alterar o formato dos bancos. Verifique especialmente:

1. ausência de múltiplas cópias da área ativa em memória;
2. liberação de camadas, marcadores, popups e `watchPosition` ao sair da aba do mapa;
3. nenhuma inclusão ilimitada de tiles no Cache Storage;
4. nenhuma renderização ilimitada de cards;
5. cancelamento correto de pesquisas anteriores durante digitação rápida;
6. compatibilidade com GitHub Pages em subpasta;
7. funcionamento online e offline após atualização do Service Worker;
8. erros no console, promessas rejeitadas e listeners duplicados;
9. acessibilidade e segurança dos valores inseridos em HTML e URLs;
10. regressões no login, seleção de área, busca, mapa, navegação externa e logout.

Faça somente mudanças justificadas por um problema reproduzível. Para cada mudança:

- explique a causa;
- altere o menor conjunto de arquivos possível;
- adicione ou atualize testes;
- rode os testes e a checagem de sintaxe;
- apresente um resumo final com arquivos alterados, riscos e roteiro de teste manual.

Não faça commit nem push até eu revisar o resultado.
