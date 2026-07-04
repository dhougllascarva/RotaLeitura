const fs = require('fs');

const LIMITE_POR_ARQUIVO = 100000;

const csv = fs.readFileSync('./entrada/base.csv', 'utf8');

const linhas = csv
  .replace(/\r/g, '')
  .split('\n')
  .filter(l => l.trim() !== '');

linhas.shift();

const areas = {};
const indexes = {};

for (const linha of linhas) {

  const colunas = linha
  .split(';')
  .map(c => c.replace(/^"|"$/g, '').trim());

  const item = [
    colunas[0] || '',
    colunas[1] || '',
    colunas[2] || '',
    colunas[3] || '',
    colunas[4] || '',
    colunas[5] || '',
    colunas[6] || '',
    colunas[7] || '',
    colunas[8] || '',
    colunas[9] || '',
    colunas[10] || ''
  ];

  const area = String(colunas[0]).substring(0,3);

  if (!areas[area]) {
    areas[area] = [];
  }

  areas[area].push(item);

}

// não precisa mais criar pasta json

/* LIMPAR JSONS ANTIGOS */

const arquivos = fs.readdirSync('./');

for (const arquivo of arquivos) {
  if (/^\d+_\d+\.json$/.test(arquivo)) {
    fs.unlinkSync('./' + arquivo);
  }
}

/* GERAR NOVOS */

for (const area in areas) {

  indexes[area] = [];

  const registros = areas[area];

  let contador = 1;

  for (let i = 0; i < registros.length; i += LIMITE_POR_ARQUIVO) {

    const parte = registros.slice(i, i + LIMITE_POR_ARQUIVO);

    const nomeArquivo = `${area}_${contador}.json`;

fs.writeFileSync(
  `./${nomeArquivo}`,
  JSON.stringify(parte)
);

    indexes[area].push(nomeArquivo);

    contador++;

  }

}

/* GERAR INDEXES */

fs.writeFileSync(
  './indexes.json',
  JSON.stringify(indexes, null, 2)
);

console.log('Conversão concluída.');

/* APAGAR JSONS ANTIGOS */

const listaArquivos = fs.readdirSync('./');

for (const arquivo of listaArquivos) {

    if (/^\d{3}(_\d+)?\.json$/.test(arquivo)) {

        fs.unlinkSync('./' + arquivo);

    }

}
