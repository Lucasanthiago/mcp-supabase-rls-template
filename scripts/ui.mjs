#!/usr/bin/env node
/**
 * Servidor estatico para a tela de prontuarios (serve web/).
 *
 *   npm run ui        -> http://127.0.0.1:4321
 *
 * Por que a tela precisa de um servidor, e nao abre com dois cliques no
 * arquivo: ela conversa com o Supabase por fetch, e de um arquivo local
 * (file://) o navegador bloqueia essas chamadas. Servida de http://127.0.0.1
 * ela tem uma origem de verdade, e o servidor MCP ja libera CORS.
 *
 * Tambem nao da para publicar essa tela como pagina na nuvem: o Supabase
 * devolve qualquer arquivo hospedado nele como text/plain, e paginas
 * publicadas em outros lugares nao podem chamar outro dominio por fetch.
 *
 * Sem dependencia: so a biblioteca padrao do Node.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// A pasta web/ guarda so o HTML: assim ela pode ser publicada como site
// estatico sem que nenhum servico confunda este servidor com a aplicacao.
const AQUI = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const PORTA = Number(process.env.PORT ?? 4321);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const servidor = createServer(async (req, res) => {
  const caminho = new URL(req.url, 'http://local').pathname;
  // normalize + prefixo fixo: nada fora de web/ pode ser servido.
  const arquivo = join(AQUI, normalize(caminho === '/' ? '/index.html' : caminho));
  if (!arquivo.startsWith(AQUI)) {
    res.writeHead(403).end('Fora do diretorio');
    return;
  }
  try {
    const corpo = await readFile(arquivo);
    const ext = arquivo.slice(arquivo.lastIndexOf('.'));
    res.writeHead(200, {
      'Content-Type': TIPOS[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(corpo);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nao encontrado');
  }
});

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`\n  Tela de prontuarios: http://127.0.0.1:${PORTA}\n`);
  console.log('  Deixe este terminal aberto. Ctrl+C encerra.\n');
});
