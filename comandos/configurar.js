const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ComponentType,
} = require('discord.js');
const { salvarConfiguracaoServidor, salvarCanaisTimes, buscarOuCriarConfigServidor } = require('../banco/db');

const TEMPO_LIMITE_MS = 5 * 60 * 1000;
const COR_EMBED = 0x5865f2;

const OPCOES_INICIAR = [
  { id: 'dono', rotulo: 'Dono' },
  { id: 'admins', rotulo: 'Admins' },
  { id: 'todos', rotulo: 'Todos' },
];

function embedIniciar() {
  return new EmbedBuilder()
    .setTitle('1/5 - Quem pode iniciar um !mix?')
    .setDescription('Marque quantas opções quiser, depois clique em Confirmar.')
    .setColor(COR_EMBED);
}

function linhaTogglesIniciar(selecionados) {
  const botoes = OPCOES_INICIAR.map((opcao) =>
    new ButtonBuilder()
      .setCustomId(`configurar_iniciar_${opcao.id}`)
      .setLabel(selecionados.has(opcao.id) ? `✅ ${opcao.rotulo}` : opcao.rotulo)
      .setStyle(selecionados.has(opcao.id) ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  const confirmar = new ButtonBuilder()
    .setCustomId('configurar_iniciar_confirmar')
    .setLabel('✅ Confirmar')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(selecionados.size === 0);

  return [new ActionRowBuilder().addComponents(...botoes, confirmar)];
}

function embedGerenciar() {
  return new EmbedBuilder()
    .setTitle('2/5 - Quem mais pode aprovar/trocar times e juntar o povo depois?')
    .setDescription(
      'O dono e os admins do servidor sempre podem gerenciar qualquer mix, além de quem criou aquela sessão específica. Escolha se mais alguém também pode:\n\n' +
        '_Separar em salas de voz (Time A/Time B) não entra nessa regra - isso já fica liberado pra qualquer jogador da sessão._'
    )
    .setColor(COR_EMBED);
}

function linhaBotoesGerenciar() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('configurar_gerenciar_criador')
        .setLabel('Só o criador do mix')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('configurar_gerenciar_todos').setLabel('Todos').setStyle(ButtonStyle.Primary)
    ),
  ];
}

function embedCargoAdmin() {
  return new EmbedBuilder().setTitle('3/5 - Qual cargo representa os admins do seu servidor?').setColor(COR_EMBED);
}

function linhaRoleSelect(cargoAtualId) {
  const menu = new RoleSelectMenuBuilder().setCustomId('configurar_cargo_admin').setMinValues(1).setMaxValues(1);
  if (cargoAtualId) menu.setDefaultRoles(cargoAtualId);
  return new ActionRowBuilder().addComponents(menu);
}

function embedCanal(numero, rotulo) {
  return new EmbedBuilder().setTitle(`${numero}/5 - Qual sala de voz é o ${rotulo}?`).setColor(COR_EMBED);
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
async function aguardarSelecaoComConfirmar({ mensagem, message, embed, montarLinhaSelect, valorInicial, customIdConfirmar }) {
  let valorAtual = valorInicial ?? null;

  while (true) {
    const interacao = await mensagem.awaitMessageComponent({
      filter: (i) => i.user.id === message.author.id,
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

module.exports = {
  nome: 'configurar',
  descricao: '!configurar - assistente de configuração do servidor (só o dono do servidor)',
  async executar(message) {
    if (message.guild.ownerId !== message.author.id) {
      return message.reply('🚫 Apenas o dono do servidor pode rodar `!configurar`.');
    }

    const configAtual = await buscarOuCriarConfigServidor(message.guild.id);

    // Todo o assistente roda numa única mensagem: cada resposta EDITA essa
    // mesma mensagem (via interacao.update()) em vez de mandar uma nova.
    const mensagem = await message.channel.send({
      embeds: [embedIniciar()],
      components: linhaTogglesIniciar(new Set()),
    });

    try {
      // 1/5 - quem pode iniciar (múltipla escolha, com toggles + confirmar)
      const selecionados = new Set();
      let interacao;

      while (true) {
        interacao = await mensagem.awaitMessageComponent({
          filter: (i) => i.user.id === message.author.id,
          componentType: ComponentType.Button,
          time: TEMPO_LIMITE_MS,
        });

        if (interacao.customId === 'configurar_iniciar_confirmar') break;

        const opcaoId = interacao.customId.replace('configurar_iniciar_', '');
        if (selecionados.has(opcaoId)) {
          selecionados.delete(opcaoId);
        } else {
          selecionados.add(opcaoId);
        }

        await interacao.update({ embeds: [embedIniciar()], components: linhaTogglesIniciar(selecionados) });
      }

      const quemPodeIniciarMix = [...selecionados];

      // 2/5 - quem mais pode gerenciar (dono/admins já são sempre garantidos)
      await interacao.update({ embeds: [embedGerenciar()], components: linhaBotoesGerenciar() });

      interacao = await mensagem.awaitMessageComponent({
        filter: (i) => i.user.id === message.author.id,
        componentType: ComponentType.Button,
        time: TEMPO_LIMITE_MS,
      });

      const quemPodeGerenciarMix = interacao.customId === 'configurar_gerenciar_todos' ? 'todos' : 'criador';

      // 3/5 - cargo admin, pré-selecionado se já houver um (ex: criado no guildCreate)
      const cargoInicial = configAtual?.cargo_admin_id ?? null;
      await interacao.update({
        embeds: [embedCargoAdmin()],
        components: [linhaRoleSelect(cargoInicial), linhaBotaoConfirmarSelecao('configurar_cargo_admin_confirmar', !cargoInicial)],
      });

      const resultadoCargo = await aguardarSelecaoComConfirmar({
        mensagem,
        message,
        embed: embedCargoAdmin(),
        montarLinhaSelect: linhaRoleSelect,
        valorInicial: cargoInicial,
        customIdConfirmar: 'configurar_cargo_admin_confirmar',
      });
      const cargoAdminId = resultadoCargo.valor;
      interacao = resultadoCargo.interacao;

      // 4/5 - canal Time A, pré-selecionado se já houver um
      const canalAInicial = configAtual?.canal_time_a_id ?? null;
      await interacao.update({
        embeds: [embedCanal(4, 'Time A')],
        components: [
          linhaChannelSelect('configurar_canal_a', canalAInicial),
          linhaBotaoConfirmarSelecao('configurar_canal_a_confirmar', !canalAInicial),
        ],
      });

      const resultadoCanalA = await aguardarSelecaoComConfirmar({
        mensagem,
        message,
        embed: embedCanal(4, 'Time A'),
        montarLinhaSelect: (id) => linhaChannelSelect('configurar_canal_a', id),
        valorInicial: canalAInicial,
        customIdConfirmar: 'configurar_canal_a_confirmar',
      });
      const canalTimeAId = resultadoCanalA.valor;
      interacao = resultadoCanalA.interacao;

      // 5/5 - canal Time B, pré-selecionado se já houver um
      const canalBInicial = configAtual?.canal_time_b_id ?? null;
      await interacao.update({
        embeds: [embedCanal(5, 'Time B')],
        components: [
          linhaChannelSelect('configurar_canal_b', canalBInicial),
          linhaBotaoConfirmarSelecao('configurar_canal_b_confirmar', !canalBInicial),
        ],
      });

      const resultadoCanalB = await aguardarSelecaoComConfirmar({
        mensagem,
        message,
        embed: embedCanal(5, 'Time B'),
        montarLinhaSelect: (id) => linhaChannelSelect('configurar_canal_b', id),
        valorInicial: canalBInicial,
        customIdConfirmar: 'configurar_canal_b_confirmar',
      });
      const canalTimeBId = resultadoCanalB.valor;
      interacao = resultadoCanalB.interacao;

      await salvarConfiguracaoServidor(message.guild.id, {
        quemPodeIniciarMix,
        quemPodeGerenciarMix,
        cargoAdminId,
      });
      await salvarCanaisTimes(message.guild.id, { canalTimeAId, canalTimeBId });

      await interacao.update({ embeds: [embedConcluido()], components: [] });
    } catch (erro) {
      if (erro?.code === 'InteractionCollectorError') {
        return mensagem.edit({ embeds: [embedTempoEsgotado()], components: [] });
      }
      throw erro;
    }
  },
};
