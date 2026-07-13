const { ChannelType } = require('discord.js');
const { salvarCanaisTimes, salvarCargoAdmin, buscarOuCriarConfigServidor } = require('../banco/db');

const NOME_CARGO_ADMIN = 'ADM-kakazim.mix';

/**
 * Cria (ou reaproveita, se já existir por nome - ex: bot removido e
 * reconvidado) as salas de voz "Time A"/"Time B" e salva os IDs em
 * config_servidor. Se falhar (ex: falta a permissão "Gerenciar Canais"),
 * loga o erro e segue sem travar o resto da configuração inicial.
 */
async function garantirCanaisDeTime(guild) {
  try {
    const canalTimeA =
      guild.channels.cache.find((c) => c.type === ChannelType.GuildVoice && c.name === 'Time A') ??
      (await guild.channels.create({ name: 'Time A', type: ChannelType.GuildVoice }));

    const canalTimeB =
      guild.channels.cache.find((c) => c.type === ChannelType.GuildVoice && c.name === 'Time B') ??
      (await guild.channels.create({ name: 'Time B', type: ChannelType.GuildVoice }));

    await salvarCanaisTimes(guild.id, { canalTimeAId: canalTimeA.id, canalTimeBId: canalTimeB.id });
    console.log(`✅ Salas de voz "Time A"/"Time B" prontas em ${guild.name} (${guild.id})`);
  } catch (erro) {
    console.error(
      `⚠️ Não foi possível criar as salas de voz automaticamente em ${guild.name} (${guild.id}):`,
      erro
    );
  }
}

/**
 * Cria (ou reaproveita, se já existir por nome) o cargo padrão de admin do
 * mix e salva o ID em config_servidor. Se falhar (ex: falta a permissão
 * "Gerenciar Cargos"), loga o erro e segue - o dono ainda pode escolher outro
 * cargo manualmente no !configurar.
 */
async function garantirCargoAdmin(guild) {
  try {
    const cargo =
      guild.roles.cache.find((r) => r.name === NOME_CARGO_ADMIN) ??
      (await guild.roles.create({ name: NOME_CARGO_ADMIN }));

    await salvarCargoAdmin(guild.id, cargo.id);
    console.log(`✅ Cargo "${NOME_CARGO_ADMIN}" pronto em ${guild.name} (${guild.id})`);
  } catch (erro) {
    console.error(
      `⚠️ Não foi possível criar o cargo "${NOME_CARGO_ADMIN}" automaticamente em ${guild.name} (${guild.id}):`,
      erro
    );
  }
}

async function aoEntrarEmServidor(guild) {
  await buscarOuCriarConfigServidor(guild.id);
  await garantirCanaisDeTime(guild);
  await garantirCargoAdmin(guild);
}

module.exports = { aoEntrarEmServidor };
