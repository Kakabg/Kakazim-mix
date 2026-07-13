const { buscarJogador, criarJogador, adicionarApelidoAlternativo } = require('../banco/db');

module.exports = {
  nome: 'play',
  descricao: '!play <nick> level:<numero> [alt:apelido1,apelido2,...]',
  async executar(message, args) {
    const guildId = message.guild.id;

    if (await buscarJogador(guildId, message.author.id)) {
      return message.reply('Você já está registrado. Use `!nome` ou `!gc` para atualizar seus dados.');
    }

    if (args.length < 2) {
      return message.reply('Uso correto: `!play <nick> level:<numero> [alt:apelido1,apelido2,...]`');
    }

    const indiceLevel = args.findIndex((arg) => /^level:\d+$/i.test(arg));
    if (indiceLevel === -1) {
      return message.reply('Informe o level no formato `level:<numero>`. Ex: `!play Kaka level:8`');
    }

    const levelGc = Number.parseInt(args[indiceLevel].split(':')[1], 10);

    const indiceAlt = args.findIndex((arg) => /^alt:/i.test(arg));
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
      return message.reply('Informe um nick válido. Ex: `!play Kaka level:8`');
    }

    if (!Number.isInteger(levelGc) || levelGc < 0) {
      return message.reply('O level informado é inválido.');
    }

    await criarJogador({ guildId, discordId: message.author.id, nickPrincipal: nick, levelGc });

    for (const apelido of apelidosAlternativos) {
      await adicionarApelidoAlternativo(guildId, message.author.id, apelido);
    }

    const infoAlt = apelidosAlternativos.length
      ? ` | Apelidos alternativos: **${apelidosAlternativos.join(', ')}**`
      : '';

    return message.reply(`✅ Cadastro criado! Nick: **${nick}** | Level GC: **${levelGc}**${infoAlt}`);
  },
};
