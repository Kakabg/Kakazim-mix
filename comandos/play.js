const { EmbedBuilder } = require('discord.js');
const { buscarPerfil, criarPerfil, adicionarApelidoAlternativo } = require('../banco/db');

function construirEmbedPerfil(jogador) {
  const nomeExibido = jogador.apelido_display || jogador.nick_principal;

  return new EmbedBuilder()
    .setTitle('👤 Perfil')
    .setColor(0x5865f2)
    .addFields(
      { name: 'Nome', value: nomeExibido, inline: true },
      { name: 'GC', value: String(jogador.level_gc), inline: true }
    );
}

module.exports = {
  nome: 'play',
  descricao: '!play <nick> <numero> [alt:apelido1,apelido2,...]',
  async executar(message, args) {
    const guildId = message.guild.id;

    const jogadorExistente = await buscarPerfil(message.author.id);
    if (jogadorExistente) {
      return message.reply({ embeds: [construirEmbedPerfil(jogadorExistente)] });
    }

    if (args.length < 2) {
      return message.reply('Uso correto: `!play <nick> <numero> [alt:apelido1,apelido2,...]`');
    }

    const indiceAlt = args.findIndex((arg) => /^alt:/i.test(arg));
    const limiteBusca = indiceAlt === -1 ? args.length : indiceAlt;

    const indiceLevel = args.slice(0, limiteBusca).findLastIndex((arg) => /^\d+$/.test(arg));
    if (indiceLevel === -1) {
      return message.reply('Informe o level como um número. Ex: `!play Kaka 8`');
    }

    const levelGc = Number.parseInt(args[indiceLevel], 10);

    const indicesExcluidos = new Set([indiceLevel]);
    let apelidosAlternativos = [];

    if (indiceAlt !== -1) {
      const textoAlt = args.slice(indiceAlt).join(' ').replace(/^alt:/i, '');
      apelidosAlternativos = textoAlt
        .split(',')
        .map((apelido) => apelido.trim())
        .filter(Boolean);

      for (let i = indiceAlt; i < args.length; i++) {
        indicesExcluidos.add(i);
      }
    }

    const nick = args
      .filter((_, indice) => !indicesExcluidos.has(indice))
      .join(' ')
      .trim();

    if (!nick) {
      return message.reply('Informe um nick válido. Ex: `!play Kaka 8`');
    }

    if (!Number.isInteger(levelGc) || levelGc < 0) {
      return message.reply('O level informado é inválido.');
    }

    await criarPerfil({ discordId: message.author.id, nickPrincipal: nick, levelGc });

    for (const apelido of apelidosAlternativos) {
      await adicionarApelidoAlternativo(guildId, message.author.id, apelido);
    }

    const infoAlt = apelidosAlternativos.length
      ? ` | Apelidos alternativos: **${apelidosAlternativos.join(', ')}**`
      : '';

    return message.reply(`✅ Cadastro criado! Nick: **${nick}** | Level GC: **${levelGc}**${infoAlt}`);
  },
};
