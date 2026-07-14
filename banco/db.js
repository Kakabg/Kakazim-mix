const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (erro) => {
  console.error('Erro inesperado no pool do Postgres:', erro);
});

async function iniciarBanco() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS perfis (
      discord_id TEXT PRIMARY KEY,
      nick_principal TEXT NOT NULL,
      apelido_display TEXT,
      level_gc INTEGER NOT NULL,
      level_faceit TEXT,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_por TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS apelidos_alternativos (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      jogador_discord_id TEXT NOT NULL,
      apelido TEXT NOT NULL,
      FOREIGN KEY (jogador_discord_id) REFERENCES perfis (discord_id)
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
      quem_pode_iniciar_mix TEXT[] NOT NULL DEFAULT ARRAY['todos']::TEXT[],
      quem_pode_gerenciar_mix TEXT NOT NULL DEFAULT 'criador'
    )
  `);

  await migrarConfigServidorParaNovoEsquema();
}

/**
 * Ajusta linhas de config_servidor criadas antes de quem_pode_iniciar_mix virar
 * lista (converte o valor único existente num array de 1 item) e antes de
 * quem_pode_gerenciar_mix virar só 'criador'/'todos' (qualquer valor antigo tipo
 * 'dono'/'admins' vira 'criador', já que dono/admins passaram a ter permissão
 * garantida por padrão, então 'criador' reproduz o nível de restrição anterior).
 */
async function migrarConfigServidorParaNovoEsquema() {
  const { rows } = await pool.query(
    `SELECT data_type FROM information_schema.columns
     WHERE table_name = 'config_servidor' AND column_name = 'quem_pode_iniciar_mix'`
  );

  if (rows[0] && rows[0].data_type !== 'ARRAY') {
    await pool.query(`
      ALTER TABLE config_servidor
        ALTER COLUMN quem_pode_iniciar_mix DROP DEFAULT,
        ALTER COLUMN quem_pode_iniciar_mix TYPE TEXT[] USING ARRAY[quem_pode_iniciar_mix],
        ALTER COLUMN quem_pode_iniciar_mix SET DEFAULT ARRAY['todos']::TEXT[]
    `);
  }

  await pool.query(`
    UPDATE config_servidor SET quem_pode_gerenciar_mix = 'criador'
    WHERE quem_pode_gerenciar_mix NOT IN ('criador', 'todos')
  `);
  await pool.query(`
    ALTER TABLE config_servidor ALTER COLUMN quem_pode_gerenciar_mix SET DEFAULT 'criador'
  `);
}

async function buscarPerfil(discordId) {
  const { rows } = await pool.query('SELECT * FROM perfis WHERE discord_id = $1', [discordId]);
  return rows[0];
}

async function criarPerfil({ discordId, nickPrincipal, levelGc, atualizadoPor }) {
  await pool.query(
    `INSERT INTO perfis (discord_id, nick_principal, apelido_display, level_gc, atualizado_por)
     VALUES ($1, $2, $2, $3, $4)`,
    [discordId, nickPrincipal, levelGc, atualizadoPor ?? discordId]
  );
  return buscarPerfil(discordId);
}

async function atualizarLevel(discordId, levelGc, atualizadoPor) {
  await pool.query(
    'UPDATE perfis SET level_gc = $1, atualizado_em = now(), atualizado_por = $2 WHERE discord_id = $3',
    [levelGc, atualizadoPor, discordId]
  );
  return buscarPerfil(discordId);
}

async function atualizarApelido(discordId, apelidoDisplay, atualizadoPor) {
  await pool.query(
    'UPDATE perfis SET apelido_display = $1, atualizado_em = now(), atualizado_por = $2 WHERE discord_id = $3',
    [apelidoDisplay, atualizadoPor, discordId]
  );
  return buscarPerfil(discordId);
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

/**
 * nick_principal/apelido_display agora são globais (tabela perfis), então a
 * busca direta não é mais restrita ao servidor. Só o apelido alternativo
 * continua por servidor (apelidos_alternativos.guild_id).
 */
async function buscarJogadorPorNick(guildId, nick) {
  const { rows: diretas } = await pool.query(
    `SELECT * FROM perfis
     WHERE LOWER(nick_principal) = LOWER($1) OR LOWER(apelido_display) = LOWER($1)`,
    [nick]
  );
  if (diretas[0]) return diretas[0];

  const { rows: viaAlternativo } = await pool.query(
    `SELECT p.* FROM perfis p
     JOIN apelidos_alternativos a ON a.jogador_discord_id = p.discord_id
     WHERE a.guild_id = $1 AND LOWER(a.apelido) = LOWER($2)
     LIMIT 1`,
    [guildId, nick]
  );
  return viaAlternativo[0];
}

/**
 * Procura se algum jogador ALÉM de `discordIdExcluir` já usa esse nick como
 * nick_principal/apelido_display (global) ou como apelido alternativo no
 * mesmo servidor. Retorna o jogador dono do nick, ou undefined se estiver livre.
 */
async function buscarDonoDoApelido(guildId, nick, discordIdExcluir) {
  const { rows: diretas } = await pool.query(
    `SELECT * FROM perfis
     WHERE discord_id != $1
     AND (LOWER(nick_principal) = LOWER($2) OR LOWER(apelido_display) = LOWER($2))`,
    [discordIdExcluir, nick]
  );
  if (diretas[0]) return diretas[0];

  const { rows: viaAlternativo } = await pool.query(
    `SELECT p.* FROM perfis p
     JOIN apelidos_alternativos a ON a.jogador_discord_id = p.discord_id
     WHERE a.guild_id = $1 AND a.jogador_discord_id != $2 AND LOWER(a.apelido) = LOWER($3)
     LIMIT 1`,
    [guildId, discordIdExcluir, nick]
  );
  return viaAlternativo[0];
}

/**
 * Lista, sem duplicatas, os nicks conhecidos: nick_principal e apelido_display
 * de todos os perfis (globais) + apelidos_alternativos cadastrados naquele
 * servidor. Útil para sugerir nomes parecidos quando uma busca por nick não
 * encontra ninguém.
 */
async function listarTodosOsNicks(guildId) {
  const nicks = new Set();

  const { rows: principais } = await pool.query('SELECT nick_principal, apelido_display FROM perfis');
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

async function salvarCargoAdmin(guildId, cargoAdminId) {
  await pool.query(
    `INSERT INTO config_servidor (guild_id, cargo_admin_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET cargo_admin_id = excluded.cargo_admin_id`,
    [guildId, cargoAdminId]
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
  buscarPerfil,
  criarPerfil,
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
  salvarCargoAdmin,
  salvarConfiguracaoServidor,
};
