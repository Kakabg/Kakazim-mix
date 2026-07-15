require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { comandos } = require('./comandos');
const { iniciarBanco } = require('./banco/db');
const { aoEntrarEmServidor } = require('./eventos/guildCreate');
const { iniciarEscutaConfiguracao } = require('./eventos/escutaConfiguracao');

const PREFIXO = '!';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

client.once('clientReady', () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
  iniciarEscutaConfiguracao(client);
});

client.on('guildCreate', aoEntrarEmServidor);

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIXO)) return;

  const args = message.content.slice(PREFIXO.length).trim().split(/\s+/);
  const nomeComando = args.shift().toLowerCase();

  const comando = comandos.get(nomeComando);
  if (!comando) return;

  try {
    await comando.executar(message, args);
  } catch (erro) {
    console.error(`Erro ao executar o comando "${nomeComando}":`, erro);
    message.reply('❌ Ocorreu um erro ao executar o comando.').catch(() => {});
  }
});

async function iniciar() {
  await iniciarBanco();
  await client.login(process.env.DISCORD_TOKEN);
}

iniciar().catch((erro) => {
  console.error('Falha ao iniciar o bot:', erro);
  process.exit(1);
});
