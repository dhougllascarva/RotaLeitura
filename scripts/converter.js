const fs = require('fs');

const LIMITE_POR_ARQUIVO = 100000;

const csv = fs.readFileSync('./entrada/base.csv', 'utf8');

const linhas = csv
  .replace(/\r/g, '')
  .split('\n')
  .filter(l => l.trim() !== '');

linhas.shift();

console.log("Total de linhas:", linhas.length);
console.log("Primeira linha:");
console.log(linhas[0]);


const areas = {};
const indexes = {};

for (const linha of linhas) {

  const colunas = linha
  .split(';')
  .map(c => c.replace(/^"|"$/g, '').trim());
  if (Object.keys(areas).length === 0) {
    console.log(colunas);
}

// A coluna 0 (Área) serve apenas para organizar os arquivos.
// Ela NÃO é gravada no JSON.

const area = String(colunas[0]).trim();

const item = [
  colunas[1] || '', // MRU
  colunas[2] || '', // Instalação
  colunas[3] || '', // Medidor
  colunas[4] || '', // Rua
  colunas[5] || '', // Número
  colunas[6] || '', // Bairro
  colunas[7] || '', // Local/Cidade
  colunas[8] || '', // Cliente
  colunas[9] || '', // Latitude
  colunas[10] || '', // Longitude
  colunas[11] || '', // LinkMapa
  colunas[12] || ''  // Pesquisa
];

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

console.log("Resumo:");

for (const area in areas) {
    console.log(area, areas[area].length);
}

console.log('Conversão concluída.');
