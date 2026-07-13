function somaLevel(time) {
  return time.reduce((total, jogador) => total + jogador.level_gc, 0);
}

function mediaLevel(time) {
  return time.length === 0 ? 0 : somaLevel(time) / time.length;
}

/**
 * Escolhe, entre `jogadores`, um subconjunto de tamanho `tamanhoA` para somar
 * ao time A (o restante soma ao time B), minimizando |médiaA - médiaB| das
 * médias FINAIS. `somaBaseA`/`contagemBaseA` e `somaBaseB`/`contagemBaseB` são
 * o nível somado e a quantidade de jogadores já fixos em cada time antes dessa
 * escolha (ex: quem foi travado manualmente com "+a vs +b") - por padrão 0,
 * reproduzindo o caso original de dividir um único grupo em dois times do
 * zero. Usa programação dinâmica sobre (quantidade escolhida, soma), guardando
 * um snapshot do estado a cada jogador processado para permitir reconstrução.
 */
function escolherSubconjuntoBalanceado(
  jogadores,
  tamanhoA,
  { somaBaseA = 0, contagemBaseA = 0, somaBaseB = 0, contagemBaseB = 0 } = {}
) {
  const niveis = jogadores.map((j) => j.level_gc);
  const n = jogadores.length;
  const tamanhoB = n - tamanhoA;

  // estadoPorPasso[i][j] = Set de somas alcançáveis escolhendo exatamente
  // j jogadores dentre os i primeiros.
  const estadoPorPasso = [Array.from({ length: tamanhoA + 1 }, () => new Set())];
  estadoPorPasso[0][0].add(0);

  for (let i = 0; i < n; i++) {
    const anterior = estadoPorPasso[i];
    const novo = anterior.map((s) => new Set(s));
    const nivel = niveis[i];

    for (let j = Math.min(i, tamanhoA - 1); j >= 0; j--) {
      for (const soma of anterior[j]) {
        novo[j + 1].add(soma + nivel);
      }
    }

    estadoPorPasso.push(novo);
  }

  const total = niveis.reduce((a, b) => a + b, 0);

  function mediaFinalA(soma) {
    const contagem = contagemBaseA + tamanhoA;
    return contagem === 0 ? 0 : (somaBaseA + soma) / contagem;
  }

  function mediaFinalB(soma) {
    const contagem = contagemBaseB + tamanhoB;
    return contagem === 0 ? 0 : (somaBaseB + (total - soma)) / contagem;
  }

  let melhorSoma = null;
  let menorDiferenca = Infinity;

  for (const soma of estadoPorPasso[n][tamanhoA]) {
    const diferenca = Math.abs(mediaFinalA(soma) - mediaFinalB(soma));

    if (diferenca < menorDiferenca) {
      menorDiferenca = diferenca;
      melhorSoma = soma;
    }
  }

  // Reconstrói, de trás para frente, quais jogadores compõem o subconjunto.
  const indicesEscolhidos = [];
  let j = tamanhoA;
  let soma = melhorSoma;

  for (let i = n; i >= 1; i--) {
    const nivel = niveis[i - 1];
    const podeIgnorar = j <= tamanhoA && estadoPorPasso[i - 1][j]?.has(soma);

    if (podeIgnorar) {
      continue;
    }

    indicesEscolhidos.push(i - 1);
    j -= 1;
    soma -= nivel;
  }

  const idsEscolhidos = new Set(indicesEscolhidos.map((indice) => jogadores[indice].discord_id));

  return {
    timeA: jogadores.filter((jog) => idsEscolhidos.has(jog.discord_id)),
    timeB: jogadores.filter((jog) => !idsEscolhidos.has(jog.discord_id)),
  };
}

/**
 * Divide os jogadores em 2 times o mais equilibrado possível, tanto em
 * quantidade (diferença máxima de 1 jogador) quanto em média de level_gc.
 */
function montarTimesBalanceados(jogadores) {
  if (jogadores.length < 2) {
    throw new Error('São necessários pelo menos 2 jogadores para montar os times.');
  }

  const tamanhoA = Math.ceil(jogadores.length / 2);
  const { timeA, timeB } = escolherSubconjuntoBalanceado(jogadores, tamanhoA);
  const diferenca = Math.abs(mediaLevel(timeA) - mediaLevel(timeB));

  return { timeA, timeB, diferenca };
}

/**
 * Monta os 2 times quando parte dos jogadores já está travada em um lado
 * específico (formato "+a +b vs +c +d"): `travadosA`/`travadosB` entram fixos,
 * e `livres` é distribuído entre os dois lados para minimizar a diferença de
 * média final, mantendo os tamanhos dos times o mais parecido possível (o
 * alvo "ideal" de cada lado é `tamanhoTime`, mas se não houver livres
 * suficientes para preencher as vagas dos dois lados, ou se sobrarem livres
 * além das vagas, o tamanho dos times continua sendo escolhido pra ficar o
 * mais equilibrado possível entre si).
 */
function montarTimesComTravados({ travadosA, travadosB, livres, tamanhoTime }) {
  const contagemBaseA = travadosA.length;
  const contagemBaseB = travadosB.length;
  const somaBaseA = somaLevel(travadosA);
  const somaBaseB = somaLevel(travadosB);
  const nLivres = livres.length;

  // Tamanho ideal (com casas decimais) do grupo de livres que deve ir pro time
  // A, de forma a igualar os tamanhos finais dos dois times. Quando há livres
  // suficientes pra preencher as vagas de ambos os lados até `tamanhoTime`,
  // esse valor coincide exatamente com "vagas restantes do time A".
  const tamanhoAIdeal = (nLivres - contagemBaseA + contagemBaseB) / 2;

  const candidatos = new Set(
    [Math.floor(tamanhoAIdeal), Math.ceil(tamanhoAIdeal)].filter((k) => k >= 0 && k <= nLivres)
  );
  if (candidatos.size === 0) {
    candidatos.add(Math.max(0, Math.min(nLivres, Math.round(tamanhoAIdeal))));
  }

  let melhorResultado = null;
  let menorDiferenca = Infinity;

  for (const tamanhoALivres of candidatos) {
    const { timeA: livresParaA, timeB: livresParaB } = escolherSubconjuntoBalanceado(livres, tamanhoALivres, {
      somaBaseA,
      contagemBaseA,
      somaBaseB,
      contagemBaseB,
    });

    const timeA = [...travadosA, ...livresParaA];
    const timeB = [...travadosB, ...livresParaB];
    const diferenca = Math.abs(mediaLevel(timeA) - mediaLevel(timeB));

    if (diferenca < menorDiferenca) {
      menorDiferenca = diferenca;
      melhorResultado = { timeA, timeB, diferenca };
    }
  }

  return melhorResultado;
}

function embaralhar(itens) {
  const resultado = [...itens];

  for (let i = resultado.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [resultado[i], resultado[j]] = [resultado[j], resultado[i]];
  }

  return resultado;
}

module.exports = { montarTimesBalanceados, montarTimesComTravados, somaLevel, mediaLevel, embaralhar };
