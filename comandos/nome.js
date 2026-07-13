const {
  buscarJogador,
  atualizarApelido,
  adicionarApelidoAlternativo,
  buscarDonoDoApelido,
} = require('../banco/db');

module.exports = {
  nome: 'nome',
  descricao: '!nome <novo_nick>',
  async executar(message, args) {
    const guildId = message.guild.id;
    const jogador = await buscarJogador(guildId, message.author.id);
    if (!jogador) {
      return message.reply('Você ainda não está registrado. Use `!play <nick> level:<numero>`.');
    }

    const novoApelido = args.join(' ').trim();
    if (!novoApelido) {
      return message.reply('Uso correto: `!nome <novo_nick>`');
    }

    const apelidoAnterior = jogador.apelido_display;

    await atualizarApelido(guildId, message.author.id, novoApelido);

    if (apelidoAnterior && apelidoAnterior !== novoApelido) {
      const dono = await buscarDonoDoApelido(guildId, apelidoAnterior, message.author.id);
      if (!dono) {
        await adicionarApelidoAlternativo(guildId, message.author.id, apelidoAnterior);
      }
    }

    return message.reply(`✅ Apelido atualizado para **${novoApelido}**`);
  },
};
