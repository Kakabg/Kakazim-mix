const { pool } = require('../banco/db');
const { rodarWizardConfiguracao } = require('../comandos/configurar');

const CANAL_NOTIFY = 'kakazim_configuracao';
const ESPERA_RECONEXAO_MS = 5000;

/**
 * Trata uma notificação recebida no canal kakazim_configuracao. Disparada pelo
 * kakazim-bot quando alguém clica em "Mix" no !configurar dele - o kakazim-mix
 * então posta a UI de configuração de mix no canal indicado, marcando quem pediu.
 */
async function tratarNotificacao(client, payload) {
  const { guildId, channelId, userId, tipo } = payload;
  if (tipo !== 'mix') return;

  const guild = await client.guilds.fetch(guildId);
  const channel = await client.channels.fetch(channelId);

  await rodarWizardConfiguracao({ guild, channel, autorId: userId, mencionar: true });
}

/**
 * Abre uma conexão dedicada (fora do pool round-robin, exigido por LISTEN/NOTIFY)
 * e mantém LISTEN no canal kakazim_configuracao. Se a conexão cair, reconecta
 * automaticamente após ESPERA_RECONEXAO_MS.
 */
async function iniciarEscutaConfiguracao(client) {
  let conexao;

  try {
    conexao = await pool.connect();
    await conexao.query(`LISTEN ${CANAL_NOTIFY}`);
    console.log(`👂 Escutando notificações no canal "${CANAL_NOTIFY}"...`);
  } catch (erro) {
    console.error(`⚠️ Falha ao conectar o LISTEN em "${CANAL_NOTIFY}", tentando de novo em ${ESPERA_RECONEXAO_MS}ms:`, erro);
    setTimeout(() => iniciarEscutaConfiguracao(client), ESPERA_RECONEXAO_MS);
    return;
  }

  conexao.on('notification', async (msg) => {
    try {
      const payload = JSON.parse(msg.payload);
      await tratarNotificacao(client, payload);
    } catch (erro) {
      console.error('⚠️ Erro ao tratar notificação de configuração:', erro);
    }
  });

  conexao.on('error', (erro) => {
    console.error(`⚠️ Conexão de LISTEN em "${CANAL_NOTIFY}" caiu, reconectando em ${ESPERA_RECONEXAO_MS}ms:`, erro);
    conexao.release(erro);
    setTimeout(() => iniciarEscutaConfiguracao(client), ESPERA_RECONEXAO_MS);
  });
}

module.exports = { iniciarEscutaConfiguracao };
