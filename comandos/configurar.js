const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
} = require('discord.js');
const {
  salvarCargoAdmin,
  salvarCanaisTimes,
  buscarOuCriarConfigServidor,
  kakazimBotEstaInstalado,
} = require('../banco/db');

const TEMPO_LIMITE_MS = 5 * 60 * 1000;
const COR_EMBED = 0x5865f2;

// Quem pode iniciar/gerenciar um !mix não é mais configurável (ver
// utils/permissoes.js: cargo fixo "Criador Mix" + autor/dono do servidor),
// então o assistente só cuida do cargo admin (usado por !gc/!nick) e das salas.
function embedCargoAdmin() {
  return new EmbedBuilder()
    .setTitle('1/3 - Qual cargo representa os admins do seu servidor?')
    .setDescription('Usado pelos comandos de admin (`!gc @jogador`, `!nick`).')
    .setColor(COR_EMBED);
}

function linhaRoleSelect(cargoAtualId) {
  const menu = new RoleSelectMenuBuilder().setCustomId('configurar_cargo_admin').setMinValues(1).setMaxValues(1);
  if (cargoAtualId) menu.setDefaultRoles(cargoAtualId);
  return new ActionRowBuilder().addComponents(menu);
}

function embedCanal(numero, rotulo) {
  return new EmbedBuilder().setTitle(`${numero}/3 - Qual sala de voz é o ${rotulo}?`).setColor(COR_EMBED);
}

function linhaChannelSelect(customId, canalAtualId) {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId(customId)
    .setChannelTypes(ChannelType.GuildVoice)
    .setMinValues(1)
    .setMaxValues(1);
  if (canalAtualId) menu.setDefaultChannels(canalAtualId);
  return new ActionRowBuilder().addComponents(menu);
}

function linhaBotaoConfirmarSelecao(customId, disabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel('✅ Confirmar')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

/**
 * Espera o dono trocar a seleção de um Role/Channel Select (o padrão
 * pré-selecionado atualiza a cada troca) e clicar em "Confirmar" pra aceitar
 * o valor atual - seja o padrão pré-preenchido (sem precisar trocar nada) ou
 * um valor novo que ele tenha escolhido.
 */
async function aguardarSelecaoComConfirmar({ mensagem, autorId, embed, montarLinhaSelect, valorInicial, customIdConfirmar }) {
  let valorAtual = valorInicial ?? null;

  while (true) {
    const interacao = await mensagem.awaitMessageComponent({
      filter: (i) => i.user.id === autorId,
      time: TEMPO_LIMITE_MS,
    });

    if (interacao.customId === customIdConfirmar) {
      return { valor: valorAtual, interacao };
    }

    valorAtual = interacao.values[0];
    await interacao.update({
      embeds: [embed],
      components: [montarLinhaSelect(valorAtual), linhaBotaoConfirmarSelecao(customIdConfirmar, false)],
    });
  }
}

function embedConcluido() {
  return new EmbedBuilder().setTitle('✅ Configuração salva com sucesso!').setColor(0x2ecc71);
}

function embedTempoEsgotado() {
  return new EmbedBuilder()
    .setTitle('⏱️ Tempo esgotado. Rode `!configurar` de novo quando quiser.')
    .setColor(0xe74c3c);
}

/**
 * Roda o assistente de configuração inteiro numa única mensagem (editada a cada
 * resposta via interacao.update()). Usado tanto pelo !configurar (quando o
 * kakazim-bot não está no servidor) quanto pelo listener de NOTIFY do Postgres,
 * disparado pelo kakazim-bot quando alguém clica em "Mix" no !configurar dele.
 */
async function rodarWizardConfiguracao({ guild, channel, autorId, mencionar }) {
  const configAtual = await buscarOuCriarConfigServidor(guild.id);

  // 1/3 - cargo admin, pré-selecionado se já houver um (ex: criado no guildCreate).
  // Todo o assistente roda numa única mensagem: cada resposta EDITA essa
  // mesma mensagem (via interacao.update()) em vez de mandar uma nova.
  const cargoInicial = configAtual?.cargo_admin_id ?? null;
  const mensagem = await channel.send({
    content: mencionar ? `<@${autorId}>` : undefined,
    embeds: [embedCargoAdmin()],
    components: [linhaRoleSelect(cargoInicial), linhaBotaoConfirmarSelecao('configurar_cargo_admin_confirmar', !cargoInicial)],
  });

  try {
    let interacao;

    const resultadoCargo = await aguardarSelecaoComConfirmar({
      mensagem,
      autorId,
      embed: embedCargoAdmin(),
      montarLinhaSelect: linhaRoleSelect,
      valorInicial: cargoInicial,
      customIdConfirmar: 'configurar_cargo_admin_confirmar',
    });
    const cargoAdminId = resultadoCargo.valor;
    interacao = resultadoCargo.interacao;

    // 2/3 - canal Time A, pré-selecionado se já houver um
    const canalAInicial = configAtual?.canal_time_a_id ?? null;
    await interacao.update({
      embeds: [embedCanal(2, 'Time A')],
      components: [
        linhaChannelSelect('configurar_canal_a', canalAInicial),
        linhaBotaoConfirmarSelecao('configurar_canal_a_confirmar', !canalAInicial),
      ],
    });

    const resultadoCanalA = await aguardarSelecaoComConfirmar({
      mensagem,
      autorId,
      embed: embedCanal(2, 'Time A'),
      montarLinhaSelect: (id) => linhaChannelSelect('configurar_canal_a', id),
      valorInicial: canalAInicial,
      customIdConfirmar: 'configurar_canal_a_confirmar',
    });
    const canalTimeAId = resultadoCanalA.valor;
    interacao = resultadoCanalA.interacao;

    // 3/3 - canal Time B, pré-selecionado se já houver um
    const canalBInicial = configAtual?.canal_time_b_id ?? null;
    await interacao.update({
      embeds: [embedCanal(3, 'Time B')],
      components: [
        linhaChannelSelect('configurar_canal_b', canalBInicial),
        linhaBotaoConfirmarSelecao('configurar_canal_b_confirmar', !canalBInicial),
      ],
    });

    const resultadoCanalB = await aguardarSelecaoComConfirmar({
      mensagem,
      autorId,
      embed: embedCanal(3, 'Time B'),
      montarLinhaSelect: (id) => linhaChannelSelect('configurar_canal_b', id),
      valorInicial: canalBInicial,
      customIdConfirmar: 'configurar_canal_b_confirmar',
    });
    const canalTimeBId = resultadoCanalB.valor;
    interacao = resultadoCanalB.interacao;

    await salvarCargoAdmin(guild.id, cargoAdminId);
    await salvarCanaisTimes(guild.id, { canalTimeAId, canalTimeBId });

    await interacao.update({ embeds: [embedConcluido()], components: [] });
  } catch (erro) {
    if (erro?.code === 'InteractionCollectorError') {
      return mensagem.edit({ embeds: [embedTempoEsgotado()], components: [] });
    }
    throw erro;
  }
}

module.exports = {
  nome: 'configurar',
  descricao: '!configurar - assistente de configuração do servidor (só o dono do servidor)',
  rodarWizardConfiguracao,
  async executar(message) {
    // Se o kakazim-bot está instalado nesse servidor, é ele quem cuida da
    // configuração de mix agora (via !configurar → Mix, disparado por NOTIFY).
    if (await kakazimBotEstaInstalado(message.guild.id)) return;

    if (message.guild.ownerId !== message.author.id) {
      return message.reply('🚫 Apenas o dono do servidor pode rodar `!configurar`.');
    }

    await rodarWizardConfiguracao({ guild: message.guild, channel: message.channel, autorId: message.author.id });
  },
};
