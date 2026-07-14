require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TABELA_BACKUP_JOGADORES = 'jogadores_backup_001';
const TABELA_BACKUP_ALTERNATIVOS = 'apelidos_alternativos_backup_001';
const TABELA_LEGADA = 'jogadores_legado_pre_perfis';

async function fazerBackupEmArquivo(client) {
  const { rows: jogadores } = await client.query('SELECT * FROM jogadores');
  const { rows: alternativos } = await client.query('SELECT * FROM apelidos_alternativos');

  const pasta = path.join(__dirname, 'backups');
  fs.mkdirSync(pasta, { recursive: true });

  const arquivo = path.join(pasta, `001-backup-${Date.now()}.json`);
  fs.writeFileSync(arquivo, JSON.stringify({ jogadores, alternativos }, null, 2));

  console.log(`📄 Backup em arquivo salvo em: ${arquivo}`);
}

async function trocarForeignKey(client, { deTabela, referenciando, colunas }) {
  const { rows: constraints } = await client.query(
    `SELECT conname FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'f'`,
    [deTabela]
  );
  for (const { conname } of constraints) {
    await client.query(`ALTER TABLE ${deTabela} DROP CONSTRAINT ${conname}`);
  }

  await client.query(
    `ALTER TABLE ${deTabela} ADD FOREIGN KEY (${colunas}) REFERENCES ${referenciando}`
  );
}

async function up() {
  const client = await pool.connect();
  try {
    await fazerBackupEmArquivo(client);

    await client.query('BEGIN');

    await client.query(`CREATE TABLE IF NOT EXISTS ${TABELA_BACKUP_JOGADORES} AS TABLE jogadores`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${TABELA_BACKUP_ALTERNATIVOS} AS TABLE apelidos_alternativos`);

    await client.query(`
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

    // Um jogador pode ter mais de uma linha em `jogadores` (uma por servidor
    // onde já usou !play). Regra de desempate: mantém o MAIOR level_gc; se
    // houver empate, o guild_id menor decide - só para ser determinístico,
    // já que hoje (checado em produção antes desta migração) não existe
    // nenhum discord_id duplicado nem level_gc divergente.
    const resultado = await client.query(`
      INSERT INTO perfis (discord_id, nick_principal, apelido_display, level_gc, atualizado_por)
      SELECT DISTINCT ON (discord_id)
        discord_id, nick_principal, apelido_display, level_gc, discord_id
      FROM jogadores
      ORDER BY discord_id, level_gc DESC, guild_id ASC
      ON CONFLICT (discord_id) DO NOTHING
    `);
    console.log(`✅ ${resultado.rowCount} perfis migrados para a tabela global.`);

    await trocarForeignKey(client, {
      deTabela: 'apelidos_alternativos',
      referenciando: 'perfis (discord_id)',
      colunas: 'jogador_discord_id',
    });

    await client.query(`ALTER TABLE jogadores RENAME TO ${TABELA_LEGADA}`);

    await client.query('COMMIT');
    console.log(`✅ Migração concluída. Tabela antiga renomeada para "${TABELA_LEGADA}" (não foi apagada).`);
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}

async function down() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT to_regclass($1) AS existe', [TABELA_LEGADA]);
    if (!rows[0].existe) {
      throw new Error(
        `Tabela ${TABELA_LEGADA} não encontrada - não é possível reverter automaticamente. ` +
          `Restaure a partir de migrations/backups/ ou das tabelas ${TABELA_BACKUP_JOGADORES}/${TABELA_BACKUP_ALTERNATIVOS}.`
      );
    }

    await client.query(`ALTER TABLE ${TABELA_LEGADA} RENAME TO jogadores`);

    await trocarForeignKey(client, {
      deTabela: 'apelidos_alternativos',
      referenciando: 'jogadores (guild_id, discord_id)',
      colunas: 'guild_id, jogador_discord_id',
    });

    await client.query('DROP TABLE IF EXISTS perfis');

    await client.query('COMMIT');
    console.log('✅ Reversão concluída: "jogadores" restaurada, "perfis" removida.');
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const acao = process.argv[2];
  const executar = acao === 'down' ? down : up;

  executar()
    .then(() => pool.end())
    .catch((erro) => {
      console.error('Erro na migração:', erro);
      return pool.end().finally(() => process.exit(1));
    });
}

module.exports = { up, down };
