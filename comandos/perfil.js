const { EmbedBuilder } = require('discord.js');
const { buscarJogador } = require('../banco/db');

module.exports = {
  nome: 'perfil',
  descricao: '!perfil - mostra seu nick e level GC atuais',
  async executar(message) {
    const jogador = await buscarJogador(message.guild.id, message.author.id);

    if (!jogador) {
      return message.reply('Você ainda não está registrado. Use `!play <nick> level:<numero>` primeiro.');
    }

    const nomeExibido = jogador.apelido_display || jogador.nick_principal;

    // TODO: quando a temporada ativa for implementada, buscar e incluir aqui
    // os pontos/resultado do jogador na temporada atual (ex: uma linha
    // "🏆 Pontos na temporada: X" usando algo como
    // buscarPontosTemporadaAtiva(jogador.discord_id)).

    const embed = new EmbedBuilder()
      .setTitle('👤 Perfil')
      .setColor(0x5865f2)
      .addFields(
        { name: 'Nome', value: nomeExibido, inline: true },
        { name: 'GC', value: String(jogador.level_gc), inline: true }
      );

    return message.reply({ embeds: [embed] });
  },
};
