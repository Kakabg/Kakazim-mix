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
 * Cargo "Criador Mix" do servidor - o único que pode iniciar um !mix.
 * Substitui config_servidor.quem_pode_iniciar_mix (dono/admins/todos), que
 * não é mais consultado.
 */
const CARGO_CRIADOR_MIX_ID = '1552865947163955220';
const NOME_CARGO_CRIADOR_MIX = 'Criador Mix';

/**
 * Posse EXATA do cargo: o membro precisa ter esse cargo atribuído. Não olha
 * hierarquia/posição - cargos listados acima dele no servidor (e o próprio
 * dono do servidor, se não tiver o cargo) não contam.
 */
function podeIniciarMix(membro) {
  return membro?.roles?.cache?.has(CARGO_CRIADOR_MIX_ID) === true;
}

/**
 * Qualquer botão de uma sessão de !mix em andamento (aprovar, sortear,
 * trocar, cancelar, seleção na tela de troca, separar em salas de voz,
 * juntar o povo) só pode ser clicado por quem digitou o !mix daquela sessão
 * ou pelo dono real do servidor (guild.ownerId) - nenhum cargo, nem admin,
 * libera além deles.
 */
function podeInteragirComMix({ usuarioId, autorId, guild }) {
  if (!usuarioId) return false;
  return usuarioId === autorId || usuarioId === guild?.ownerId;
}

module.exports = { ehAdmin, podeIniciarMix, podeInteragirComMix, CARGO_CRIADOR_MIX_ID, NOME_CARGO_CRIADOR_MIX };
