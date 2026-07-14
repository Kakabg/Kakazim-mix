/**
 * O dono do servidor sempre conta como admin, mesmo antes do !configurar
 * definir um cargo_admin_id - assim nenhum servidor fica travado sem admin
 * enquanto não roda o assistente de configuração.
 */
function ehAdmin(membro, guild, cargoAdminId) {
  if (membro.id === guild.ownerId) return true;
  if (!cargoAdminId) return false;
  return membro.roles.cache.has(cargoAdminId);
}

/**
 * `selecoes` é a lista (0 a 3 itens) marcada em config_servidor.quem_pode_iniciar_mix:
 * 'dono', 'admins' e/ou 'todos'. Basta atender UMA das opções marcadas.
 */
function podeIniciarMix(selecoes, membro, guild, cargoAdminId) {
  if (!selecoes || selecoes.length === 0) return false;
  if (selecoes.includes('todos')) return true;
  if (selecoes.includes('dono') && membro.id === guild.ownerId) return true;
  if (selecoes.includes('admins') && ehAdmin(membro, guild, cargoAdminId)) return true;
  return false;
}

/**
 * Dono e admins sempre podem gerenciar qualquer mix em andamento (aprovar,
 * trocar times, juntar o povo de volta depois de separar em salas de voz).
 * `regraGerenciar` ('criador' ou 'todos') só decide se, ALÉM deles, mais
 * alguém também pode - quem criou aquela sessão específica de !mix já é
 * sempre liberado separadamente, na checagem de quem chamou o comando.
 * Note que separar em salas de voz NÃO passa por essa regra - ver
 * `podeInteragirComMix`.
 */
function podeGerenciarMix(regraGerenciar, membro, guild, cargoAdminId) {
  if (ehAdmin(membro, guild, cargoAdminId)) return true;
  return regraGerenciar === 'todos';
}

const BOTOES_DE_GERENCIAMENTO = new Set(['mix_aprovar', 'mix_sortear', 'mix_cancelar', 'mix_juntar']);
const BOTOES_DE_SEPARAR_EM_SALAS = new Set(['mix_voz_sim', 'mix_voz_nao']);

function ehBotaoDeGerenciamento(customId) {
  return BOTOES_DE_GERENCIAMENTO.has(customId) || customId.startsWith('mix_troca');
}

/**
 * Decide quem pode clicar em cada botão de uma sessão de !mix em andamento.
 *
 * Separar em salas de voz (mix_voz_sim/mix_voz_nao) fica sempre liberado pra
 * qualquer jogador que faz parte daquela sessão, sem depender de admin, dono
 * ou de quem criou o mix - o objetivo é que quem clicar primeiro resolve mais
 * rápido, já que é uma ação de baixo risco (só move gente de canal).
 *
 * Os demais botões restritos (aprovar, sortear, cancelar, trocar, juntar o
 * povo) seguem `podeGerenciarMix`, com quem criou a sessão sempre liberado
 * também. Botões não listados aqui (ex: seleção de jogador na tela de troca)
 * ficam liberados por padrão.
 */
function podeInteragirComMix({ customId, usuarioId, autorId, idsDaSessao, membro, guild, config }) {
  if (BOTOES_DE_SEPARAR_EM_SALAS.has(customId)) {
    return idsDaSessao.has(usuarioId);
  }

  if (!ehBotaoDeGerenciamento(customId)) return true;
  if (usuarioId === autorId) return true;

  return podeGerenciarMix(config.quem_pode_gerenciar_mix, membro, guild, config.cargo_admin_id);
}

module.exports = { ehAdmin, podeIniciarMix, podeGerenciarMix, podeInteragirComMix };
