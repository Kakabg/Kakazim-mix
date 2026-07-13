const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  MessageFlags,
} = require('discord.js');
const {
  buscarJogador,
  buscarJogadorPorNick,
  criarJogador,
  listarTodosOsNicks,
  buscarOuCriarConfigServidor,
} = require('../../banco/db');
const { podeIniciarMix, podeGerenciarMix } = require('../../utils/permissoes');
const { montarTimesBalanceados, montarTimesComTravados, mediaLevel, embaralhar } = require('./montarTimes');

const TAMANHO_TIME = Number.parseInt(process.env.TAMANHO_TIME, 10) || 5;
const NIVEL_PADRAO_NOVATO = Number.parseInt(process.env.NIVEL_PADRAO_NOVATO, 10) || 10;

const TEMPO_LIMITE_MS = 15 * 60 * 1000;

function nomeExibicao(jogador, fallback) {
  return jogador?.apelido_display || jogador?.nick_principal || fallback;
}

/**
 * Extrai os nicks informados via "+nick" (adicionar) e "-nick" (remover) numa
 * lista de tokens. Cada "+" ou "-" inicia um novo nick, que pode conter
 * espaços até o próximo "+"/"-".
 * Ex: "+Fulano -Ciclano" -> { adicionar: ["Fulano"], remover: ["Ciclano"] }
 * Ex: "+Dj Salamoni +MKB" -> { adicionar: ["Dj Salamoni", "MKB"], remover: [] }
 */
function agruparPorSinal(tokens) {
  const indicePrimeiro = tokens.findIndex((arg) => arg.startsWith('+') || arg.startsWith('-'));
  if (indicePrimeiro === -1) return { adicionar: [], remover: [] };

  const adicionar = [];
  const remover = [];
  let atual = null;
  let sinalAtual = null;

  const finalizarAtual = () => {
    if (atual === null) return;
    const nick = atual.trim();
    if (!nick) return;
    (sinalAtual === '+' ? adicionar : remover).push(nick);
  };

  for (const token of tokens.slice(indicePrimeiro)) {
    if (token.startsWith('+') || token.startsWith('-')) {
      finalizarAtual();
      sinalAtual = token[0];
      atual = token.slice(1);
    } else if (atual !== null) {
      atual += ` ${token}`;
    }
  }

  finalizarAtual();

  return { adicionar, remover };
}

/**
 * Interpreta os argumentos do !mix. Formato normal: "+nick" adiciona,
 * "-nick" remove. Formato "vs" (quem vem antes do "vs" trava no Time A, quem
 * vem depois trava no Time B): "+a +b vs +c +d", aceitando "-nick" em
 * qualquer um dos dois lados pra remover do time todo.
 */
function extrairComandoMix(args) {
  const indiceVs = args.findIndex((arg) => arg.toLowerCase() === 'vs');

  if (indiceVs === -1) {
    const { adicionar, remover } = agruparPorSinal(args);
    return { modoVs: false, adicionar, remover };
  }

  const antes = agruparPorSinal(args.slice(0, indiceVs));
  const depois = agruparPorSinal(args.slice(indiceVs + 1));

  return {
    modoVs: true,
    travadosANomes: antes.adicionar,
    travadosBNomes: depois.adicionar,
    remover: [...antes.remover, ...depois.remover],
  };
}

const LIMITE_DISTANCIA_SUGESTAO = 2;

function distanciaLevenshtein(a, b) {
  const linhas = a.length;
  const colunas = b.length;
  const dp = Array.from({ length: linhas + 1 }, () => new Array(colunas + 1).fill(0));

  for (let i = 0; i <= linhas; i++) dp[i][0] = i;
  for (let j = 0; j <= colunas; j++) dp[0][j] = j;

  for (let i = 1; i <= linhas; i++) {
    for (let j = 1; j <= colunas; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[linhas][colunas];
}

/**
 * Procura, entre os nicks conhecidos, o mais parecido com o nome buscado
 * (case-insensitive). Retorna null se o mais próximo ainda estiver acima do
 * limite de distância aceitável.
 */
function sugerirNickParecido(nomeBuscado, todosOsNicks) {
  const buscadoNormalizado = nomeBuscado.toLowerCase();

  let melhorNick = null;
  let menorDistancia = Infinity;

  for (const nick of todosOsNicks) {
    const distancia = distanciaLevenshtein(buscadoNormalizado, nick.toLowerCase());
    if (distancia < menorDistancia) {
      menorDistancia = distancia;
      melhorNick = nick;
    }
  }

  return menorDistancia <= LIMITE_DISTANCIA_SUGESTAO ? melhorNick : null;
}

function formatarAvisoNaoEncontrado(nomeBuscado, todosOsNicks) {
  const sugestao = sugerirNickParecido(nomeBuscado, todosOsNicks);
  const sufixo = sugestao ? ` Você quis dizer: ${sugestao}?` : '';
  return `⚠️ Jogador '${nomeBuscado}' não encontrado.${sufixo}`;
}

/**
 * Resolve uma lista de nicks (texto) em jogadores cadastrados no servidor.
 * Deduplica dentro da própria lista, mas NÃO contra outras listas - quem
 * chama decide o que fazer com IDs repetidos entre grupos diferentes.
 */
async function resolverNomesParaJogadores(guildId, nomes) {
  const resolvidos = [];
  const naoEncontrados = [];
  const idsVistos = new Set();

  for (const nome of nomes) {
    const jogador = await buscarJogadorPorNick(guildId, nome);

    if (!jogador) {
      naoEncontrados.push(nome);
      continue;
    }

    if (idsVistos.has(jogador.discord_id)) continue;
    idsVistos.add(jogador.discord_id);

    resolvidos.push({ ...jogador, nome: nomeExibicao(jogador, jogador.nick_principal) });
  }

  return { resolvidos, naoEncontrados };
}

function formatarTime(time, tamanhoIdeal, mediaAdversario) {
  const linhas = time.map((j) => `• ${j.nome} (level ${j.level_gc})`);

  for (let i = time.length; i < tamanhoIdeal; i++) {
    linhas.push(`• COMPLETE (nível ${mediaAdversario})`);
  }

  return linhas.join('\n');
}

function formatarDiferenca(diferenca) {
  return Number.isInteger(diferenca) ? String(diferenca) : diferenca.toFixed(1);
}

function construirEmbedSorteio({ timeA, timeB, diferenca }, status) {
  const mediaA = Math.round(mediaLevel(timeA));
  const mediaB = Math.round(mediaLevel(timeB));

  return new EmbedBuilder()
    .setTitle('🎮 Mix montado!')
    .setColor(0x2ecc71)
    .addFields(
      {
        name: `Time A (${timeA.length}/${TAMANHO_TIME} - média: ${mediaA})`,
        value: formatarTime(timeA, TAMANHO_TIME, mediaB),
        inline: true,
      },
      {
        name: `Time B (${timeB.length}/${TAMANHO_TIME} - média: ${mediaB})`,
        value: formatarTime(timeB, TAMANHO_TIME, mediaA),
        inline: true,
      }
    )
    .setFooter({ text: `Diferença de nível médio entre os times: ${formatarDiferenca(diferenca)} | ${status}` })
    .setTimestamp();
}

function linhaBotoesSorteio() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mix_aprovar').setLabel('✅ Aprovar').setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('mix_sortear')
      .setLabel('🔄 Sortear de novo')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('mix_trocar').setLabel('🔄 Trocar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mix_cancelar').setLabel('❌ Cancelar').setStyle(ButtonStyle.Danger)
  );
}

function linhaBotoesVoz() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mix_voz_sim').setLabel('Sim').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('mix_voz_nao').setLabel('Não').setStyle(ButtonStyle.Danger)
  );
}

function linhaBotaoJuntar() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mix_juntar').setLabel('🔙 Juntar o Povo').setStyle(ButtonStyle.Primary)
  );
}

const MAX_JOGADORES_TROCA = 20;

/**
 * Monta os botões da tela de troca: um botão por jogador de cada time
 * (COMPLETE nunca gera botão, pois não existe jogador real naquela posição),
 * até 5 por linha, seguidos de uma linha com Confirmar/Cancelar troca.
 */
function construirBotoesTroca(timeAtual, selecionadosA, selecionadosB) {
  const linhas = [];
  let linhaAtual = new ActionRowBuilder();

  const adicionarBotaoJogador = (jogador, time) => {
    if (linhaAtual.components.length === 5) {
      linhas.push(linhaAtual);
      linhaAtual = new ActionRowBuilder();
    }

    const selecionados = time === 'A' ? selecionadosA : selecionadosB;
    const selecionado = selecionados.has(jogador.discord_id);

    linhaAtual.addComponents(
      new ButtonBuilder()
        .setCustomId(`mix_troca_jogador_${time}_${jogador.discord_id}`)
        .setLabel(selecionado ? `✅ ${jogador.nome}` : jogador.nome)
        .setStyle(selecionado ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
  };

  for (const jogador of timeAtual.timeA) adicionarBotaoJogador(jogador, 'A');
  for (const jogador of timeAtual.timeB) adicionarBotaoJogador(jogador, 'B');

  if (linhaAtual.components.length > 0) linhas.push(linhaAtual);

  const selecaoValida = selecionadosA.size === selecionadosB.size && selecionadosA.size > 0;

  linhas.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('mix_troca_confirmar')
        .setLabel('✅ Confirmar troca')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!selecaoValida),
      new ButtonBuilder()
        .setCustomId('mix_troca_cancelar')
        .setLabel('❌ Cancelar troca')
        .setStyle(ButtonStyle.Danger)
    )
  );

  return linhas;
}

function trocarJogadores(timeAtual, selecionadosA, selecionadosB) {
  const novoTimeA = timeAtual.timeA
    .filter((j) => !selecionadosA.has(j.discord_id))
    .concat(timeAtual.timeB.filter((j) => selecionadosB.has(j.discord_id)));

  const novoTimeB = timeAtual.timeB
    .filter((j) => !selecionadosB.has(j.discord_id))
    .concat(timeAtual.timeA.filter((j) => selecionadosA.has(j.discord_id)));

  return {
    timeA: novoTimeA,
    timeB: novoTimeB,
    diferenca: Math.abs(mediaLevel(novoTimeA) - mediaLevel(novoTimeB)),
  };
}

function ehBotaoRestrito(customId) {
  if (
    customId === 'mix_aprovar' ||
    customId === 'mix_sortear' ||
    customId === 'mix_cancelar' ||
    customId === 'mix_juntar'
  ) {
    return true;
  }
  return customId.startsWith('mix_troca');
}

function podeInteragir(interaction, autorId, config) {
  if (!ehBotaoRestrito(interaction.customId)) return true;
  if (interaction.user.id === autorId) return true;
  return podeGerenciarMix(config.quem_pode_gerenciar_mix, interaction.member, interaction.guild, config.cargo_admin_id);
}

async function moverJogadoresParaCanal(guild, jogadores, canalId) {
  if (!canalId) return;

  for (const jogador of jogadores) {
    try {
      const membro = await guild.members.fetch(jogador.discord_id);
      if (membro.voice.channelId) {
        await membro.voice.setChannel(canalId);
      }
    } catch {
      // Jogador desconectado ou sem permissão para mover - ignora silenciosamente.
    }
  }
}

function contarMembrosReais(canal) {
  if (!canal) return 0;
  return canal.members.filter((membro) => !membro.user.bot).size;
}

/**
 * Acha o menor N >= 2 tal que nem "Time A (N)" nem "Time B (N)" já existam
 * como sala de voz no servidor, pra numerar uma nova sessão simultânea sem
 * colidir com outras sessões temporárias já em andamento.
 */
function proximoNumeroDeSalaLivre(guild) {
  let numero = 2;
  while (
    guild.channels.cache.some((c) => c.name === `Time A (${numero})`) ||
    guild.channels.cache.some((c) => c.name === `Time B (${numero})`)
  ) {
    numero += 1;
  }
  return numero;
}

/**
 * Decide em quais salas de voz mover os times: usa as salas principais
 * configuradas (Time A/Time B) se elas existirem e estiverem vazias; senão
 * (já tem gente dentro, indicando outro mix em andamento, ou nem estão
 * configuradas) cria um par de salas temporárias extras só pra essa sessão.
 */
async function resolverCanaisParaMover(guild, config) {
  const canalA = config.canal_time_a_id
    ? await guild.channels.fetch(config.canal_time_a_id).catch(() => null)
    : null;
  const canalB = config.canal_time_b_id
    ? await guild.channels.fetch(config.canal_time_b_id).catch(() => null)
    : null;

  const principalDisponivel = canalA && canalB && contarMembrosReais(canalA) === 0 && contarMembrosReais(canalB) === 0;

  if (principalDisponivel) {
    return { canalTimeAId: canalA.id, canalTimeBId: canalB.id, temporarios: false };
  }

  const numero = proximoNumeroDeSalaLivre(guild);
  const novoCanalA = await guild.channels.create({ name: `Time A (${numero})`, type: ChannelType.GuildVoice });
  const novoCanalB = await guild.channels.create({ name: `Time B (${numero})`, type: ChannelType.GuildVoice });

  return { canalTimeAId: novoCanalA.id, canalTimeBId: novoCanalB.id, temporarios: true, numero };
}

async function moverTimesParaVoz(guild, timeA, timeB, canais) {
  await moverJogadoresParaCanal(guild, timeA, canais.canalTimeAId);
  await moverJogadoresParaCanal(guild, timeB, canais.canalTimeBId);
}

/**
 * Apaga as salas temporárias 30s depois de todo mundo voltar pro canal
 * original - dá tempo de qualquer straggler ainda saindo da sala. Nunca mexe
 * nas salas principais configuradas do servidor, só nas criadas dinamicamente.
 */
function agendarExclusaoCanaisTemporarios(guild, canalTimeAId, canalTimeBId) {
  setTimeout(async () => {
    for (const canalId of [canalTimeAId, canalTimeBId]) {
      try {
        const canal = await guild.channels.fetch(canalId).catch(() => null);
        if (canal) await canal.delete();
      } catch (erro) {
        console.error(`Falha ao excluir sala de voz temporária ${canalId}:`, erro);
      }
    }
  }, 30_000);
}

module.exports = {
  nome: 'mix',
  descricao:
    '!mix [+nick ...] [-nick ...] - monta 2 times com quem está no seu canal de voz atual. ' +
    'Formato alternativo: !mix +a +b vs +c +d trava quem vem antes do "vs" no Time A e quem vem depois no Time B.',
  async executar(message, args) {
    const guildId = message.guild.id;
    const config = await buscarOuCriarConfigServidor(guildId);

    const membroAutor = message.member ?? (await message.guild.members.fetch(message.author.id));

    if (!podeIniciarMix(config.quem_pode_iniciar_mix, membroAutor, message.guild, config.cargo_admin_id)) {
      return message.reply('🚫 Você não tem permissão para iniciar um `!mix` neste servidor.');
    }

    const canalVoz = membroAutor.voice.channel;

    if (!canalVoz) {
      return message.reply('Você precisa estar em um canal de voz para usar o `!mix`.');
    }

    const membrosVoz = canalVoz.members.filter((membro) => !membro.user.bot);

    const jogadoresRegistrados = [];
    const registradosAutomaticamente = [];
    const idsAdicionados = new Set();

    for (const membro of membrosVoz.values()) {
      let jogador = await buscarJogador(guildId, membro.id);

      if (!jogador) {
        jogador = await criarJogador({
          guildId,
          discordId: membro.id,
          nickPrincipal: membro.displayName,
          levelGc: NIVEL_PADRAO_NOVATO,
        });
        registradosAutomaticamente.push({ discordId: membro.id, level: NIVEL_PADRAO_NOVATO });
      }

      jogadoresRegistrados.push({
        ...jogador,
        nome: nomeExibicao(jogador, membro.displayName),
      });
      idsAdicionados.add(jogador.discord_id);
    }

    const comando = extrairComandoMix(args);
    const precisaDeTodosOsNicks =
      comando.remover.length > 0 ||
      (comando.modoVs
        ? comando.travadosANomes.length > 0 || comando.travadosBNomes.length > 0
        : comando.adicionar.length > 0);
    const todosOsNicks = precisaDeTodosOsNicks ? await listarTodosOsNicks(guildId) : [];

    // Remoções valem tanto no modo normal quanto no modo "vs".
    const apelidosRemoverNaoEncontrados = [];
    const apelidosRemoverForaDaLista = [];

    for (const apelido of comando.remover) {
      const jogador = await buscarJogadorPorNick(guildId, apelido);

      if (!jogador) {
        apelidosRemoverNaoEncontrados.push(apelido);
        continue;
      }

      if (!idsAdicionados.has(jogador.discord_id)) {
        apelidosRemoverForaDaLista.push(apelido);
        continue;
      }

      const indice = jogadoresRegistrados.findIndex((j) => j.discord_id === jogador.discord_id);
      if (indice !== -1) jogadoresRegistrados.splice(indice, 1);
      idsAdicionados.delete(jogador.discord_id);
    }

    if (apelidosRemoverNaoEncontrados.length > 0) {
      const avisos = apelidosRemoverNaoEncontrados.map((nome) =>
        formatarAvisoNaoEncontrado(nome, todosOsNicks)
      );
      await message.channel.send(avisos.join('\n'));
    }

    if (apelidosRemoverForaDaLista.length > 0) {
      await message.channel.send(
        `⚠️ Não foi possível remover (não está na lista de disponíveis): ${apelidosRemoverForaDaLista.join(', ')}`
      );
    }

    let contextoMontagem;

    if (comando.modoVs) {
      const { resolvidos: travadosA, naoEncontrados: naoEncontradosA } = await resolverNomesParaJogadores(
        guildId,
        comando.travadosANomes
      );
      const { resolvidos: travadosB, naoEncontrados: naoEncontradosB } = await resolverNomesParaJogadores(
        guildId,
        comando.travadosBNomes
      );

      const naoEncontrados = [...naoEncontradosA, ...naoEncontradosB];
      if (naoEncontrados.length > 0) {
        const avisos = naoEncontrados.map((nome) => formatarAvisoNaoEncontrado(nome, todosOsNicks));
        await message.channel.send(avisos.join('\n'));
      }

      const idsTravadosA = new Set(travadosA.map((j) => j.discord_id));
      const conflitantes = travadosB.filter((j) => idsTravadosA.has(j.discord_id));

      if (conflitantes.length > 0) {
        return message.reply(
          `🚫 ${conflitantes.map((j) => j.nome).join(', ')} não pode estar travado nos dois lados do "vs" ao mesmo tempo.`
        );
      }

      const idsTravados = new Set([...idsTravadosA, ...travadosB.map((j) => j.discord_id)]);

      // Quem foi travado por nick mas não estava na call entra no pool mesmo assim
      // (mesmo comportamento do "+nick" no modo normal).
      for (const jogador of [...travadosA, ...travadosB]) {
        if (!idsAdicionados.has(jogador.discord_id)) {
          jogadoresRegistrados.push(jogador);
          idsAdicionados.add(jogador.discord_id);
        }
      }

      const livres = jogadoresRegistrados.filter((j) => !idsTravados.has(j.discord_id));

      if (jogadoresRegistrados.length < 2) {
        return message.reply(
          `São necessários pelo menos **2** jogadores registrados no canal de mix para montar os times. ` +
            `Encontrados: **${jogadoresRegistrados.length}**.`
        );
      }

      contextoMontagem = { modoVs: true, travadosA, travadosB, livres };
    } else {
      const apelidosNaoEncontrados = [];

      for (const apelido of comando.adicionar) {
        const jogador = await buscarJogadorPorNick(guildId, apelido);

        if (!jogador) {
          apelidosNaoEncontrados.push(apelido);
          continue;
        }

        if (idsAdicionados.has(jogador.discord_id)) continue;

        jogadoresRegistrados.push({
          ...jogador,
          nome: nomeExibicao(jogador, jogador.nick_principal),
        });
        idsAdicionados.add(jogador.discord_id);
      }

      if (apelidosNaoEncontrados.length > 0) {
        const avisos = apelidosNaoEncontrados.map((nome) => formatarAvisoNaoEncontrado(nome, todosOsNicks));
        await message.channel.send(avisos.join('\n'));
      }

      if (jogadoresRegistrados.length < 2) {
        return message.reply(
          `São necessários pelo menos **2** jogadores registrados no canal de mix para montar os times. ` +
            `Encontrados: **${jogadoresRegistrados.length}**.`
        );
      }

      contextoMontagem = { modoVs: false, pool: jogadoresRegistrados };
    }

    function remontarTimes() {
      if (contextoMontagem.modoVs) {
        return montarTimesComTravados({
          travadosA: contextoMontagem.travadosA,
          travadosB: contextoMontagem.travadosB,
          livres: embaralhar(contextoMontagem.livres),
          tamanhoTime: TAMANHO_TIME,
        });
      }
      return montarTimesBalanceados(embaralhar(contextoMontagem.pool));
    }

    let timeAtual = remontarTimes();

    for (const registrado of registradosAutomaticamente) {
      await message.channel.send(
        `<@${registrado.discordId}> Você foi registrado automaticamente com level ${registrado.level} (provisório). Use \`!gc <numero>\` para atualizar seu level real.`
      );
    }

    let aprovado = false;
    let modoTroca = false;
    let selecionadosA = new Set();
    let selecionadosB = new Set();
    let canaisDaSessao = null;

    const mensagem = await message.channel.send({
      embeds: [construirEmbedSorteio(timeAtual, 'Aguardando aprovação')],
      components: [linhaBotoesSorteio()],
    });

    const coletor = mensagem.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: TEMPO_LIMITE_MS,
    });

    async function avancarParaAprovado(interaction) {
      aprovado = true;
      const embed = construirEmbedSorteio(timeAtual, '✅ Times aprovados e travados').addFields({
        name: '🔊 Separar em salas de voz?',
        value: 'Escolha uma opção abaixo.',
      });

      await interaction.update({ embeds: [embed], components: [linhaBotoesVoz()] });
    }

    coletor.on('collect', async (interaction) => {
      if (!podeInteragir(interaction, message.author.id, config)) {
        await interaction.reply({
          content: '🚫 Você não tem permissão para interagir com este mix.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (interaction.customId === 'mix_sortear') {
        if (aprovado || modoTroca) return interaction.deferUpdate();

        timeAtual = remontarTimes();
        await interaction.update({
          embeds: [construirEmbedSorteio(timeAtual, 'Aguardando aprovação')],
          components: [linhaBotoesSorteio()],
        });
        return;
      }

      if (interaction.customId === 'mix_cancelar') {
        if (aprovado || modoTroca) return interaction.deferUpdate();

        coletor.stop('cancelado');
        await interaction.update({
          embeds: [construirEmbedSorteio(timeAtual, '❌ Mix cancelado')],
          components: [],
        });
        return;
      }

      if (interaction.customId === 'mix_aprovar') {
        if (aprovado || modoTroca) return interaction.deferUpdate();

        await avancarParaAprovado(interaction);
        return;
      }

      if (interaction.customId === 'mix_trocar') {
        if (aprovado || modoTroca) return interaction.deferUpdate();

        const totalJogadores = timeAtual.timeA.length + timeAtual.timeB.length;
        if (totalJogadores > MAX_JOGADORES_TROCA) {
          await interaction.reply({
            content: `🚫 Não é possível trocar jogadores: times grandes demais para exibir os botões (máximo ${MAX_JOGADORES_TROCA} jogadores no total).`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        modoTroca = true;
        selecionadosA = new Set();
        selecionadosB = new Set();

        await interaction.update({
          embeds: [construirEmbedSorteio(timeAtual, 'Selecione os jogadores que vão trocar de time')],
          components: construirBotoesTroca(timeAtual, selecionadosA, selecionadosB),
        });
        return;
      }

      if (interaction.customId.startsWith('mix_troca_jogador_')) {
        if (!modoTroca) return interaction.deferUpdate();

        const [, , , time, discordId] = interaction.customId.split('_');
        const selecionados = time === 'A' ? selecionadosA : selecionadosB;

        if (selecionados.has(discordId)) {
          selecionados.delete(discordId);
        } else {
          selecionados.add(discordId);
        }

        await interaction.update({
          components: construirBotoesTroca(timeAtual, selecionadosA, selecionadosB),
        });
        return;
      }

      if (interaction.customId === 'mix_troca_cancelar') {
        if (!modoTroca) return interaction.deferUpdate();

        modoTroca = false;
        selecionadosA = new Set();
        selecionadosB = new Set();

        await interaction.update({
          embeds: [construirEmbedSorteio(timeAtual, 'Aguardando aprovação')],
          components: [linhaBotoesSorteio()],
        });
        return;
      }

      if (interaction.customId === 'mix_troca_confirmar') {
        const selecaoValida = selecionadosA.size === selecionadosB.size && selecionadosA.size > 0;
        if (!modoTroca || !selecaoValida) return interaction.deferUpdate();

        timeAtual = trocarJogadores(timeAtual, selecionadosA, selecionadosB);
        modoTroca = false;
        selecionadosA = new Set();
        selecionadosB = new Set();

        await avancarParaAprovado(interaction);
        return;
      }

      if (interaction.customId === 'mix_voz_sim') {
        await interaction.deferUpdate();
        canaisDaSessao = await resolverCanaisParaMover(message.guild, config);
        await moverTimesParaVoz(message.guild, timeAtual.timeA, timeAtual.timeB, canaisDaSessao);

        const aviso = canaisDaSessao.temporarios
          ? `✅ Times definidos - as salas principais estavam ocupadas, então movi todo mundo pras salas temporárias "Time A (${canaisDaSessao.numero})"/"Time B (${canaisDaSessao.numero})"`
          : '✅ Times definidos - jogadores movidos para as salas de voz';
        const embed = construirEmbedSorteio(timeAtual, aviso);
        await mensagem.edit({ embeds: [embed], components: [linhaBotaoJuntar()] });
        return;
      }

      if (interaction.customId === 'mix_voz_nao') {
        coletor.stop('finalizado');
        const embed = construirEmbedSorteio(timeAtual, '✅ Times definidos');
        await interaction.update({ embeds: [embed], components: [] });
        return;
      }

      if (interaction.customId === 'mix_juntar') {
        coletor.stop('finalizado');
        await interaction.deferUpdate();
        await moverJogadoresParaCanal(
          message.guild,
          [...timeAtual.timeA, ...timeAtual.timeB],
          canalVoz.id
        );
        const embed = construirEmbedSorteio(timeAtual, '✅ Povo reunido de volta no canal original');
        await mensagem.edit({ embeds: [embed], components: [] });

        if (canaisDaSessao?.temporarios) {
          agendarExclusaoCanaisTemporarios(message.guild, canaisDaSessao.canalTimeAId, canaisDaSessao.canalTimeBId);
        }
      }
    });

    coletor.on('end', async (_colecionados, razao) => {
      if (razao === 'cancelado' || razao === 'finalizado') return;

      await mensagem.edit({ components: [] }).catch(() => {});
    });
  },
};
