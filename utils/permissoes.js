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
 * Confere se um membro atende a uma regra de permissão salva em
 * config_servidor ('dono', 'admins' ou 'todos').
 */
function atendeRegraDePermissao(regra, membro, guild, cargoAdminId) {
  if (regra === 'todos') return true;
  if (regra === 'dono') return membro.id === guild.ownerId;
  if (regra === 'admins') return ehAdmin(membro, guild, cargoAdminId);
  return false;
}

module.exports = { ehAdmin, atendeRegraDePermissao };
