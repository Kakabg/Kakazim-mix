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
const { salvarConfiguracaoServidor, salvarCanaisTimes } = require('../banco/db');

const TEMPO_LIMITE_MS = 5 * 60 * 1000;

const OPCOES_PERMISSAO = [
  { id: 'dono', rotulo: 'Dono' },
  { id: 'admins', rotulo: 'Admins' },
  { id: 'todos', rotulo: 'Todos' },
];

function linhaBotoesPermissao(customIdPrefixo) {
  return new ActionRowBuilder().addComponents(
    OPCOES_PERMISSAO.map((opcao) =>
      new ButtonBuilder()
        .setCustomId(`${customIdPrefixo}_${opcao.id}`)
        .setLabel(opcao.rotulo)
        .setStyle(ButtonStyle.Primary)
    )
  );
}

async function perguntarPermissao(message, titulo, customIdPrefixo) {
  const embed = new EmbedBuilder().setTitle(titulo).setColor(0x5865f2);

  const mensagem = await message.channel.send({
    embeds: [embed],
    components: [linhaBotoesPermissao(customIdPrefixo)],
  });

  const interacao = await mensagem.awaitMessageComponent({
    filter: (i) => i.user.id === message.author.id,
    componentType: ComponentType.Button,
    time: TEMPO_LIMITE_MS,
  });

  const escolha = interacao.customId.slice(customIdPrefixo.length + 1);
  const opcaoEscolhida = OPCOES_PERMISSAO.find((o) => o.id === escolha);

  await interacao.update({
    embeds: [embed.setFooter({ text: `Escolhido: ${opcaoEscolhida.rotulo}` })],
    components: [],
  });

  return escolha;
}

async function perguntarCargoAdmin(message) {
  const embed = new EmbedBuilder()
    .setTitle('3/5 - Qual cargo representa os admins do seu servidor?')
    .setColor(0x5865f2);

  const menu = new RoleSelectMenuBuilder()
    .setCustomId('configurar_cargo_admin')
    .setMinValues(1)
    .setMaxValues(1);

  const mensagem = await message.channel.send({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
  });

  const interacao = await mensagem.awaitMessageComponent({
    filter: (i) => i.user.id === message.author.id,
    componentType: ComponentType.RoleSelect,
    time: TEMPO_LIMITE_MS,
  });

  const cargoId = interacao.values[0];

  await interacao.update({
    embeds: [embed.setFooter({ text: `Escolhido: cargo selecionado` })],
    components: [],
  });

  return cargoId;
}

async function perguntarCanalVoz(message, titulo, customId) {
  const embed = new EmbedBuilder().setTitle(titulo).setColor(0x5865f2);

  const menu = new ChannelSelectMenuBuilder()
    .setCustomId(customId)
    .setChannelTypes(ChannelType.GuildVoice)
    .setMinValues(1)
    .setMaxValues(1);

  const mensagem = await message.channel.send({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
  });

  const interacao = await mensagem.awaitMessageComponent({
    filter: (i) => i.user.id === message.author.id,
    componentType: ComponentType.ChannelSelect,
    time: TEMPO_LIMITE_MS,
  });

  const canalId = interacao.values[0];

  await interacao.update({
    embeds: [embed.setFooter({ text: `Escolhido: canal selecionado` })],
    components: [],
  });

  return canalId;
}

module.exports = {
  nome: 'configurar',
  descricao: '!configurar - assistente de configuração do servidor (só o dono do servidor)',
  async executar(message) {
    if (message.guild.ownerId !== message.author.id) {
      return message.reply('🚫 Apenas o dono do servidor pode rodar `!configurar`.');
    }

    try {
      const quemPodeIniciarMix = await perguntarPermissao(
        message,
        '1/5 - Quem pode iniciar um !mix?',
        'configurar_iniciar'
      );
      const quemPodeGerenciarMix = await perguntarPermissao(
        message,
        '2/5 - Quem pode aprovar/trocar times/mexer nas salas de voz?',
        'configurar_gerenciar'
      );
      const cargoAdminId = await perguntarCargoAdmin(message);
      const canalTimeAId = await perguntarCanalVoz(
        message,
        '4/5 - Qual sala de voz é o Time A?',
        'configurar_canal_a'
      );
      const canalTimeBId = await perguntarCanalVoz(
        message,
        '5/5 - Qual sala de voz é o Time B?',
        'configurar_canal_b'
      );

      await salvarConfiguracaoServidor(message.guild.id, {
        quemPodeIniciarMix,
        quemPodeGerenciarMix,
        cargoAdminId,
      });
      await salvarCanaisTimes(message.guild.id, { canalTimeAId, canalTimeBId });

      await message.channel.send('✅ Configuração salva com sucesso!');
    } catch (erro) {
      if (erro?.code === 'InteractionCollectorError') {
        return message.channel.send('⏱️ Tempo esgotado. Rode `!configurar` de novo quando quiser.');
      }
      throw erro;
    }
  },
};
