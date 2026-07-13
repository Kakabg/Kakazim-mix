const play = require('./play');
const gc = require('./gc');
const nome = require('./nome');
const nick = require('./nick');
const perfil = require('./perfil');
const mix = require('./mix');
const configurar = require('./configurar');

const comandos = new Map();

for (const comando of [play, gc, nome, nick, perfil, mix, configurar]) {
  comandos.set(comando.nome, comando);
}

module.exports = { comandos };
