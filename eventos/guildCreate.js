const { ChannelType } = require('discord.js');
const { salvarCanaisTimes, buscarOuCriarConfigServidor } = require('../banco/db');

/**
 * Roda quando o bot entra num servidor novo: cria as salas de voz padrão do
 * mix e já salva os IDs em config_servidor. Se a criação falhar (ex: falta a
 * permissão "Gerenciar Canais"), garante pelo menos que existe uma linha de
 * configuração para o servidor, com os canais em branco - dá pra apontar pra
 * canais existentes depois via !configurar.
 */
async function aoEntrarEmServidor(guild) {
  try {
    const canalTimeA = await guild.channels.create({ name: 'Time A', type: ChannelType.GuildVoice });
    const canalTimeB = await guild.channels.create({ name: 'Time B', type: ChannelType.GuildVoice });

    await salvarCanaisTimes(guild.id, { canalTimeAId: canalTimeA.id, canalTimeBId: canalTimeB.id });
    console.log(`✅ Salas de voz "Time A"/"Time B" criadas em ${guild.name} (${guild.id})`);
  } catch (erro) {
    console.error(
      `⚠️ Não foi possível criar as salas de voz automaticamente em ${guild.name} (${guild.id}):`,
      erro
    );
    await buscarOuCriarConfigServidor(guild.id);
  }
}

module.exports = { aoEntrarEmServidor };
