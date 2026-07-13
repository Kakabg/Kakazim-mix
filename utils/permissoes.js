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
 * trocar times, mexer nas salas de voz). `regraGerenciar` ('criador' ou
 * 'todos') só decide se, ALÉM deles, mais alguém também pode - quem criou
 * aquela sessão específica de !mix já é sempre liberado separadamente, na
 * checagem de quem chamou o comando.
 */
function podeGerenciarMix(regraGerenciar, membro, guild, cargoAdminId) {
  if (ehAdmin(membro, guild, cargoAdminId)) return true;
  return regraGerenciar === 'todos';
}

module.exports = { ehAdmin, podeIniciarMix, podeGerenciarMix };
