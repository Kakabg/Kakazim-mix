require('dotenv').config();
const { buscarJogador, criarJogador, atualizarApelido } = require('../banco/db');

const GUILD_ID_PADRAO = '772208315178156052';

async function importar(url, guildId) {
  const resposta = await fetch(url);
  if (!resposta.ok) {
    throw new Error(`Falha ao buscar jogadores (${resposta.status}): ${await resposta.text()}`);
  }

  const jogadores = await resposta.json();
  let criados = 0;
  let jaExistiam = 0;

  for (const jogador of jogadores) {
    const existente = await buscarJogador(guildId, jogador.discord_id);

    if (existente) {
      jaExistiam += 1;
      console.log(`⏭️  Já existe: ${jogador.nick_principal} (${jogador.discord_id}) - pulado.`);
      continue;
    }

    await criarJogador({
      guildId,
      discordId: jogador.discord_id,
      nickPrincipal: jogador.nick_principal,
      levelGc: jogador.level_gc,
    });

    if (jogador.apelido_display && jogador.apelido_display !== jogador.nick_principal) {
      await atualizarApelido(guildId, jogador.discord_id, jogador.apelido_display);
    }

    criados += 1;
    console.log(`✅ Criado: ${jogador.nick_principal} (${jogador.discord_id}) - level ${jogador.level_gc}`);
  }

  console.log('\n--- Resumo da importação ---');
  console.log(`Total recebido: ${jogadores.length}`);
  console.log(`Criados: ${criados}`);
  console.log(`Já existiam (pulados): ${jaExistiam}`);

  return { total: jogadores.length, criados, jaExistiam };
}

if (require.main === module) {
  const url = process.argv[2];
  const guildId = process.argv[3] || GUILD_ID_PADRAO;

  if (!url) {
    console.error('Uso: node scripts/importar-do-kakazim.js <url-da-rota-de-exportacao> [guildId]');
    process.exit(1);
  }

  importar(url, guildId)
    .then(() => process.exit(0))
    .catch((erro) => {
      console.error('Erro na importação:', erro);
      process.exit(1);
    });
}

module.exports = { importar };
