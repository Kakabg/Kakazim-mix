const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (erro) => {
  console.error('Erro inesperado no pool do Postgres:', erro);
});

async function iniciarBanco() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jogadores (
      guild_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      nick_principal TEXT NOT NULL,
      apelido_display TEXT,
      level_gc INTEGER NOT NULL,
      PRIMARY KEY (guild_id, discord_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS apelidos_alternativos (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      jogador_discord_id TEXT NOT NULL,
      apelido TEXT NOT NULL,
      FOREIGN KEY (guild_id, jogador_discord_id) REFERENCES jogadores (guild_id, discord_id)
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_apelidos_alternativos_unico
    ON apelidos_alternativos (guild_id, jogador_discord_id, LOWER(apelido))
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS config_servidor (
      guild_id TEXT PRIMARY KEY,
      canal_time_a_id TEXT,
      canal_time_b_id TEXT,
      cargo_admin_id TEXT,
      quem_pode_iniciar_mix TEXT NOT NULL DEFAULT 'todos',
      quem_pode_gerenciar_mix TEXT NOT NULL DEFAULT 'admins'
    )
  `);
}

async function buscarJogador(guildId, discordId) {
  const { rows } = await pool.query(
    'SELECT * FROM jogadores WHERE guild_id = $1 AND discord_id = $2',
    [guildId, discordId]
  );
  return rows[0];
}

async function criarJogador({ guildId, discordId, nickPrincipal, levelGc }) {
  await pool.query(
    `INSERT INTO jogadores (guild_id, discord_id, nick_principal, apelido_display, level_gc)
     VALUES ($1, $2, $3, $3, $4)`,
    [guildId, discordId, nickPrincipal, levelGc]
  );
  return buscarJogador(guildId, discordId);
}

async function atualizarLevel(guildId, discordId, levelGc) {
  await pool.query('UPDATE jogadores SET level_gc = $1 WHERE guild_id = $2 AND discord_id = $3', [
    levelGc,
    guildId,
    discordId,
  ]);
  return buscarJogador(guildId, discordId);
}

async function atualizarApelido(guildId, discordId, apelidoDisplay) {
  await pool.query(
    'UPDATE jogadores SET apelido_display = $1 WHERE guild_id = $2 AND discord_id = $3',
    [apelidoDisplay, guildId, discordId]
  );
  return buscarJogador(guildId, discordId);
}

async function adicionarApelidoAlternativo(guildId, discordId, apelido) {
  const { rows } = await pool.query(
    `SELECT 1 FROM apelidos_alternativos
     WHERE guild_id = $1 AND jogador_discord_id = $2 AND LOWER(apelido) = LOWER($3)`,
    [guildId, discordId, apelido]
  );

  if (rows.length > 0) {
    return { criado: false };
  }

  await pool.query(
    'INSERT INTO apelidos_alternativos (guild_id, jogador_discord_id, apelido) VALUES ($1, $2, $3)',
    [guildId, discordId, apelido]
  );

  return { criado: true };
}

async function listarApelidosAlternativos(guildId, discordId) {
  const { rows } = await pool.query(
    'SELECT apelido FROM apelidos_alternativos WHERE guild_id = $1 AND jogador_discord_id = $2 ORDER BY id',
    [guildId, discordId]
  );
  return rows.map((linha) => linha.apelido);
}

async function buscarJogadorPorNick(guildId, nick) {
  const { rows: diretas } = await pool.query(
    `SELECT * FROM jogadores
     WHERE guild_id = $1 AND (LOWER(nick_principal) = LOWER($2) OR LOWER(apelido_display) = LOWER($2))`,
    [guildId, nick]
  );
  if (diretas[0]) return diretas[0];

  const { rows: viaAlternativo } = await pool.query(
    `SELECT j.* FROM jogadores j
     JOIN apelidos_alternativos a ON a.guild_id = j.guild_id AND a.jogador_discord_id = j.discord_id
     WHERE j.guild_id = $1 AND LOWER(a.apelido) = LOWER($2)
     LIMIT 1`,
    [guildId, nick]
  );
  return viaAlternativo[0];
}

/**
 * Procura se algum jogador ALÉM de `discordIdExcluir` já usa esse nick como
 * nick_principal, apelido_display ou apelido alternativo, no mesmo servidor.
 * Retorna o jogador dono do nick, ou undefined se estiver livre.
 */
async function buscarDonoDoApelido(guildId, nick, discordIdExcluir) {
  const { rows: diretas } = await pool.query(
    `SELECT * FROM jogadores
     WHERE guild_id = $1 AND discord_id != $2
     AND (LOWER(nick_principal) = LOWER($3) OR LOWER(apelido_display) = LOWER($3))`,
    [guildId, discordIdExcluir, nick]
  );
  if (diretas[0]) return diretas[0];

  const { rows: viaAlternativo } = await pool.query(
    `SELECT j.* FROM jogadores j
     JOIN apelidos_alternativos a ON a.guild_id = j.guild_id AND a.jogador_discord_id = j.discord_id
     WHERE j.guild_id = $1 AND a.jogador_discord_id != $2 AND LOWER(a.apelido) = LOWER($3)
     LIMIT 1`,
    [guildId, discordIdExcluir, nick]
  );
  return viaAlternativo[0];
}

/**
 * Lista, sem duplicatas, todos os nicks conhecidos no servidor: nick_principal,
 * apelido_display e apelidos_alternativos de todos os jogadores daquele guild_id.
 * Útil para sugerir nomes parecidos quando uma busca por nick não encontra ninguém.
 */
async function listarTodosOsNicks(guildId) {
  const nicks = new Set();

  const { rows: principais } = await pool.query(
    'SELECT nick_principal, apelido_display FROM jogadores WHERE guild_id = $1',
    [guildId]
  );
  for (const linha of principais) {
    if (linha.nick_principal) nicks.add(linha.nick_principal);
    if (linha.apelido_display) nicks.add(linha.apelido_display);
  }

  const { rows: alternativos } = await pool.query(
    'SELECT apelido FROM apelidos_alternativos WHERE guild_id = $1',
    [guildId]
  );
  for (const linha of alternativos) {
    nicks.add(linha.apelido);
  }

  return [...nicks];
}

async function buscarConfigServidor(guildId) {
  const { rows } = await pool.query('SELECT * FROM config_servidor WHERE guild_id = $1', [guildId]);
  return rows[0];
}

/**
 * Garante que existe uma linha de configuração para o servidor, criando uma com
 * os valores padrão se ainda não existir (ex: bot adicionado antes do guildCreate
 * conseguir rodar, ou enquanto offline).
 */
async function buscarOuCriarConfigServidor(guildId) {
  const existente = await buscarConfigServidor(guildId);
  if (existente) return existente;

  await pool.query(
    'INSERT INTO config_servidor (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING',
    [guildId]
  );
  return buscarConfigServidor(guildId);
}

async function salvarCanaisTimes(guildId, { canalTimeAId, canalTimeBId }) {
  await pool.query(
    `INSERT INTO config_servidor (guild_id, canal_time_a_id, canal_time_b_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id) DO UPDATE SET
       canal_time_a_id = excluded.canal_time_a_id,
       canal_time_b_id = excluded.canal_time_b_id`,
    [guildId, canalTimeAId, canalTimeBId]
  );
  return buscarConfigServidor(guildId);
}

async function salvarConfiguracaoServidor(guildId, { quemPodeIniciarMix, quemPodeGerenciarMix, cargoAdminId }) {
  await pool.query(
    `INSERT INTO config_servidor (guild_id, quem_pode_iniciar_mix, quem_pode_gerenciar_mix, cargo_admin_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id) DO UPDATE SET
       quem_pode_iniciar_mix = excluded.quem_pode_iniciar_mix,
       quem_pode_gerenciar_mix = excluded.quem_pode_gerenciar_mix,
       cargo_admin_id = excluded.cargo_admin_id`,
    [guildId, quemPodeIniciarMix, quemPodeGerenciarMix, cargoAdminId]
  );
  return buscarConfigServidor(guildId);
}

module.exports = {
  pool,
  iniciarBanco,
  buscarJogador,
  criarJogador,
  atualizarLevel,
  atualizarApelido,
  adicionarApelidoAlternativo,
  listarApelidosAlternativos,
  buscarJogadorPorNick,
  buscarDonoDoApelido,
  listarTodosOsNicks,
  buscarConfigServidor,
  buscarOuCriarConfigServidor,
  salvarCanaisTimes,
  salvarConfiguracaoServidor,
};
