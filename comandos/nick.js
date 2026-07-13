const {
  buscarJogador,
  adicionarApelidoAlternativo,
  buscarDonoDoApelido,
  buscarConfigServidor,
} = require('../banco/db');
const { ehAdmin } = require('../utils/permissoes');

function nomeExibicao(jogador) {
  return jogador.apelido_display || jogador.nick_principal;
}

module.exports = {
  nome: 'nick',
  descricao: '!nick <apelido> @jogador (admin) - adiciona um apelido alternativo a um jogador',
  async executar(message, args) {
    const guildId = message.guild.id;
    const membro = message.member ?? (await message.guild.members.fetch(message.author.id));
    const config = await buscarConfigServidor(guildId);

    if (!ehAdmin(membro, message.guild, config?.cargo_admin_id)) {
      return message.reply('Apenas administradores podem usar este comando.');
    }

    const mencao = message.mentions.users.first();
    if (!mencao) {
      return message.reply('Uso correto: `!nick <apelido> @jogador`');
    }

    const apelido = args
      .filter((arg) => !/^<@!?\d+>$/.test(arg))
      .join(' ')
      .trim();

    if (!apelido) {
      return message.reply('Uso correto: `!nick <apelido> @jogador`');
    }

    const jogadorAlvo = await buscarJogador(guildId, mencao.id);
    if (!jogadorAlvo) {
      return message.reply('Esse jogador ainda não está registrado. Peça para ele usar `!play`.');
    }

    const dono = await buscarDonoDoApelido(guildId, apelido, mencao.id);
    if (dono) {
      return message.reply(`🚫 O apelido "${apelido}" já está em uso por **${nomeExibicao(dono)}**.`);
    }

    const resultado = await adicionarApelidoAlternativo(guildId, mencao.id, apelido);
    const nomeAlvo = nomeExibicao(jogadorAlvo);

    if (!resultado.criado) {
      return message.reply(`ℹ️ **${nomeAlvo}** já tinha o apelido "${apelido}" cadastrado.`);
    }

    return message.reply(`✅ Apelido "${apelido}" adicionado para **${nomeAlvo}**.`);
  },
};
