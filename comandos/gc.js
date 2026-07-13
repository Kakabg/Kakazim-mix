const { buscarJogador, atualizarLevel, buscarConfigServidor } = require('../banco/db');
const { ehAdmin } = require('../utils/permissoes');

function nomeExibicao(jogador, fallback) {
  return jogador?.apelido_display || jogador?.nick_principal || fallback;
}

module.exports = {
  nome: 'gc',
  descricao: '!gc <numero> | !gc @jogador <numero> (admin)',
  async executar(message, args) {
    const guildId = message.guild.id;
    const mencao = message.mentions.users.first();

    if (mencao) {
      const membro = message.member ?? (await message.guild.members.fetch(message.author.id));
      const config = await buscarConfigServidor(guildId);

      if (!ehAdmin(membro, message.guild, config?.cargo_admin_id)) {
        return message.reply('Apenas administradores podem alterar o level de outro jogador.');
      }

      const jogadorAlvo = await buscarJogador(guildId, mencao.id);
      if (!jogadorAlvo) {
        return message.reply('Esse jogador ainda não está registrado. Peça para ele usar `!play`.');
      }

      const argNumero = args.find((arg) => /^\d+$/.test(arg));
      if (!argNumero) {
        return message.reply('Uso correto: `!gc @jogador <numero>`');
      }

      const novoLevel = Number.parseInt(argNumero, 10);
      await atualizarLevel(guildId, mencao.id, novoLevel);

      const nome = nomeExibicao(jogadorAlvo, mencao.username);
      await message.channel.send(`🔼 **${nome}** atualizou o level para **${novoLevel}**`);
      return;
    }

    const jogador = await buscarJogador(guildId, message.author.id);
    if (!jogador) {
      return message.reply('Você ainda não está registrado. Use `!play <nick> level:<numero>`.');
    }

    if (args.length < 1 || !/^\d+$/.test(args[0])) {
      return message.reply('Uso correto: `!gc <numero>`');
    }

    const novoLevel = Number.parseInt(args[0], 10);
    await atualizarLevel(guildId, message.author.id, novoLevel);

    const nome = nomeExibicao(jogador, message.author.username);
    await message.channel.send(`🔼 **${nome}** atualizou o level para **${novoLevel}**`);
  },
};
