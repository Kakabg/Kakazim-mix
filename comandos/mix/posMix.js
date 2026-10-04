const { ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder } = require('discord.js');
const { mediaLevel } = require('./montarTimes');

// Fluxo DEPOIS do mix pronto (times aprovados e, se escolhido, separados em
// salas): "Jogar novamente" / "Encerrar", e dentro de "Jogar novamente" o
// laço "Repetir times" / "Alterar players" (Trocar, Adicionar) até "Separar
// salas". Só montagem de botões e regras puras aqui - o fluxo com Discord
// fica em comandos/mix/index.js.

function linhaBotoesPosMix() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mix_jogar_novamente').setLabel('🔁 Jogar novamente').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('mix_encerrar').setLabel('🏁 Encerrar').setStyle(ButtonStyle.Danger)
  );
}

function linhaBotoesJogarNovamente() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mix_repetir_times').setLabel('♻️ Repetir times').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('mix_alterar_players').setLabel('✏️ Alterar players').setStyle(ButtonStyle.Secondary)
  );
}

function botaoSepararSalas() {
  return new ButtonBuilder().setCustomId('mix_separar_salas').setLabel('🔊 Separar salas').setStyle(ButtonStyle.Success);
}

function linhaBotaoSepararSalas() {
  return new ActionRowBuilder().addComponents(botaoSepararSalas());
}

/**
 * "Alterar players": Trocar + Adicionar; depois da primeira alteração entra
 * também o "Separar salas" (o laço só termina quando separa). Adicionar fica
 * desabilitado quando os dois times já estão cheios.
 */
function linhaBotoesAlterar({ podeAdicionar, comSepararSalas }) {
  const linha = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mix_pos_trocar').setLabel('🔄 Trocar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('mix_adicionar')
      .setLabel('➕ Adicionar')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!podeAdicionar)
  );
  if (comSepararSalas) linha.addComponents(botaoSepararSalas());
  return linha;
}

/** Tela do "Adicionar": seletor de membros do servidor (até `vagas`) + cancelar. */
function linhasAdicionar(vagas) {
  return [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('mix_adicionar_selecao')
        .setPlaceholder(`Escolha quem entra (até ${vagas})`)
        .setMinValues(1)
        .setMaxValues(Math.max(1, Math.min(vagas, 25)))
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('mix_adicionar_cancelar').setLabel('❌ Cancelar').setStyle(ButtonStyle.Danger)
    ),
  ];
}

function vagasLivres(timeAtual, tamanhoTime) {
  return Math.max(0, tamanhoTime - timeAtual.timeA.length) + Math.max(0, tamanhoTime - timeAtual.timeB.length);
}

/**
 * Regra do "Adicionar" (a mais simples): cada novo jogador entra no time com
 * MENOS gente; empate vai pro time de média de level menor. Ninguém que já
 * estava muda de time (pra reequilibrar, usa o "Trocar"). Time cheio
 * (tamanhoTime) não recebe mais ninguém - quem sobra volta em `recusados`.
 * Quem já está em algum dos times é ignorado.
 */
function adicionarAosTimes(timeAtual, novos, tamanhoTime) {
  const timeA = [...timeAtual.timeA];
  const timeB = [...timeAtual.timeB];
  const jaNoMix = new Set([...timeA, ...timeB].map((j) => j.discord_id));
  const adicionados = [];
  const recusados = [];

  for (const jogador of novos) {
    if (jaNoMix.has(jogador.discord_id)) continue;
    const cabeA = timeA.length < tamanhoTime;
    const cabeB = timeB.length < tamanhoTime;
    if (!cabeA && !cabeB) {
      recusados.push(jogador);
      continue;
    }

    let destino;
    if (cabeA && !cabeB) destino = timeA;
    else if (cabeB && !cabeA) destino = timeB;
    else if (timeA.length !== timeB.length) destino = timeA.length < timeB.length ? timeA : timeB;
    else destino = mediaLevel(timeA) <= mediaLevel(timeB) ? timeA : timeB;

    destino.push(jogador);
    jaNoMix.add(jogador.discord_id);
    adicionados.push({ jogador, time: destino === timeA ? 'A' : 'B' });
  }

  return {
    timeAtual: { timeA, timeB, diferenca: Math.abs(mediaLevel(timeA) - mediaLevel(timeB)) },
    adicionados,
    recusados,
  };
}

/**
 * Pra onde cada jogador volta no "Encerrar": a sala em que estava quando
 * entrou no mix (início do !mix, ou o momento do "Adicionar"); sem registro
 * ou sala que não existe mais -> a sala de quem iniciou o !mix.
 */
function destinoOriginal(salaOriginalPorJogador, discordId, salaPadraoId, salaExiste) {
  const original = salaOriginalPorJogador.get(discordId);
  if (original && salaExiste(original)) return original;
  return salaPadraoId;
}

module.exports = {
  linhaBotoesPosMix,
  linhaBotoesJogarNovamente,
  linhaBotaoSepararSalas,
  linhaBotoesAlterar,
  linhasAdicionar,
  vagasLivres,
  adicionarAosTimes,
  destinoOriginal,
};
