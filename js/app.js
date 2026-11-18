// PMSC Estudos — protótipo (vanilla JS + localStorage).
'use strict';

/* ================= Estado ================= */
const STORAGE_KEY = 'pmsc-estudos-v1';
const ESTADO_PADRAO = { sessoes: [], feitos: {}, tentativas: [], cards: {}, redacoes: [], timer: null };

function carregar() {
  try {
    const salvo = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...ESTADO_PADRAO, ...(salvo || {}) };
  } catch {
    return { ...ESTADO_PADRAO };
  }
}
let S = carregar();
function salvarLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch { /* armazenamento indisponível */ }
}
function salvar() {
  S._atualizadoEm = Date.now();
  salvarLocal();
  try { window.PMSC_onSalvar?.(S); } catch { /* sync opcional */ }
}
// Ponte para a sincronização na nuvem (js/sync.js). Sem ela, o app funciona só local.
window.PMSC = {
  obter: () => S,
  substituir: (novo) => { S = { ...ESTADO_PADRAO, ...novo }; salvarLocal(); render(); },
};

/* ================= Utilitários ================= */
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoje = () => isoLocal(new Date());
const paraData = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const addDias = (iso, n) => { const d = paraData(iso); d.setDate(d.getDate() + n); return isoLocal(d); };
const difDias = (a, b) => Math.round((paraData(b) - paraData(a)) / 86400000);
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const fmtData = (iso) => { const d = paraData(iso); return `${DIAS[d.getDay()].slice(0, 3)} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const nomeD = (d) => DISCIPLINAS[d]?.nome || d;
const corD = (d) => DISCIPLINAS[d]?.cor || '#64748b';
const embaralhar = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${pad(m % 60)}` : `${m} min`);
const pct = (a, t) => (t ? Math.round((a / t) * 100) : 0);

/* ================= Cronograma ================= */
function semanaDe(iso) {
  const w = Math.floor(difDias(CONFIG.inicio, iso) / 7);
  return Math.max(0, Math.min(3, w));
}
function resolverDisc(d, w) {
  if (d === 'ti') return w % 2 === 0 ? 'trans' : 'info';
  return d;
}
function blocosDoDia(iso) {
  const wd = paraData(iso).getDay();
  if (!MODELO_SEMANA[wd] || iso < CONFIG.inicio || iso >= CONFIG.prova) return [];
  const w = semanaDe(iso);
  return MODELO_SEMANA[wd].map((raw, i) => {
    const d = resolverDisc(raw, w);
    // Quantas vezes essa disciplina já apareceu nos dias anteriores da semana
    let ocorr = 0;
    for (let dia = 1; dia < wd; dia++) {
      ocorr += MODELO_SEMANA[dia].filter((x) => resolverDisc(x, w) === d).length;
    }
    ocorr += MODELO_SEMANA[wd].slice(0, i).filter((x) => resolverDisc(x, w) === d).length;
    const lista = ASSUNTOS[d]?.[w] || [];
    const assunto = lista[ocorr] || lista[lista.length - 1] || 'Revisão';
    return { d, assunto, chave: `${iso}#${i}` };
  });
}
function diasDeEstudo() {
  const dias = [];
  for (let iso = CONFIG.inicio; iso < CONFIG.prova; iso = addDias(iso, 1)) {
    if (blocosDoDia(iso).length) dias.push(iso);
  }
  return dias;
}

/* ================= Timer (Pomodoro) ================= */
let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach((t) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.2, audioCtx.currentTime + t);
      o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.25);
    });
  } catch { /* sem áudio */ }
}
function notificar(msg) {
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification('PMSC Estudos', { body: msg }); } catch { /* ignore */ }
}
function timerNovo(d, bloco) {
  return { fase: 'foco', d, bloco: bloco || null, totalMs: CONFIG.blocoMin * 60000, restanteMs: CONFIG.blocoMin * 60000, fim: null, inicioFoco: null };
}
function timerRestante() {
  const t = S.timer; if (!t) return 0;
  return t.fim ? Math.max(0, t.fim - Date.now()) : t.restanteMs;
}
function registrarSessao(d, min) {
  if (min < 1) return;
  S.sessoes.push({ data: hoje(), d, min });
}
function timerIniciar(d, bloco) {
  if (S.timer && bloco && S.timer.bloco !== bloco) {
    // Trocou de bloco: salva o tempo já estudado no bloco anterior
    if (S.timer.fase === 'foco') registrarSessao(S.timer.d, Math.round((S.timer.totalMs - timerRestante()) / 60000));
    S.timer = null;
  }
  if (!S.timer) S.timer = timerNovo(d, bloco);
  if (!S.timer.fim) {
    S.timer.fim = Date.now() + S.timer.restanteMs;
    if (S.timer.fase === 'foco' && !S.timer.inicioFoco) S.timer.inicioFoco = Date.now();
  }
  try { if ('Notification' in window && Notification.permission === 'default') Promise.resolve(Notification.requestPermission()).catch(() => {}); } catch { /* bloqueado */ }
  salvar(); render();
}
function timerPausar() {
  const t = S.timer; if (!t || !t.fim) return;
  t.restanteMs = Math.max(0, t.fim - Date.now()); t.fim = null; salvar(); render();
}
function timerEncerrar() {
  const t = S.timer; if (!t) return;
  if (t.fase === 'foco') {
    const decorrido = Math.round((t.totalMs - timerRestante()) / 60000);
    registrarSessao(t.d, decorrido);
  }
  S.timer = null; salvar(); render();
}
function timerTick() {
  const t = S.timer;
  if (t && t.fim && Date.now() >= t.fim) {
    beep();
    if (t.fase === 'foco') {
      registrarSessao(t.d, Math.round(t.totalMs / 60000));
      if (t.bloco) S.feitos[t.bloco] = true;
      notificar(`Bloco de ${nomeD(t.d)} concluído! Pausa de ${CONFIG.pausaMin} min.`);
      S.timer = { fase: 'pausa', d: t.d, bloco: null, totalMs: CONFIG.pausaMin * 60000, restanteMs: CONFIG.pausaMin * 60000, fim: Date.now() + CONFIG.pausaMin * 60000 };
    } else {
      notificar('Pausa encerrada. Bora para o próximo bloco!');
      S.timer = null;
    }
    salvar(); render();
    return;
  }
  const el = $('#timer-display');
  if (el && t) {
    const ms = timerRestante();
    el.textContent = `${pad(Math.floor(ms / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}`;
    const barra = $('#timer-barra');
    if (barra) barra.style.width = `${100 - (ms / t.totalMs) * 100}%`;
    document.title = `${el.textContent} · ${t.fase === 'foco' ? nomeD(t.d) : 'Pausa'}`;
  } else if (!t) {
    document.title = 'PMSC Estudos';
  }
}

/* ================= Desempenho ================= */
function statsPorDisciplina() {
  const r = {};
  Object.keys(DISCIPLINAS).forEach((d) => { r[d] = { total: 0, acertos: 0, chutes: 0, min: 0, minSemana: 0 }; });
  S.tentativas.forEach((t) => {
    if (!r[t.d]) return;
    r[t.d].total++;
    if (t.status === 'acertou') r[t.d].acertos++;
    if (t.status === 'chutou') r[t.d].chutes++;
  });
  const inicioSemana = addDias(hoje(), -((paraData(hoje()).getDay() + 6) % 7));
  S.sessoes.forEach((s) => {
    if (!r[s.d]) return;
    r[s.d].min += s.min;
    if (s.data >= inicioSemana) r[s.d].minSemana += s.min;
  });
  return r;
}
function prioridades() {
  const grupos = {};
  S.tentativas.forEach((t) => {
    const k = `${t.d}|${(t.a || 'Geral').trim().toLowerCase()}`;
    grupos[k] = grupos[k] || { d: t.d, a: t.a || 'Geral', total: 0, erros: 0 };
    grupos[k].total++;
    if (t.status !== 'acertou') grupos[k].erros++;
  });
  return Object.values(grupos)
    .filter((g) => g.erros > 0)
    .map((g) => ({ ...g, taxa: g.erros / g.total, peso: (DISCIPLINAS[g.d]?.questoes || 4) * (g.erros / g.total) * Math.min(g.total, 5) }))
    .sort((a, b) => b.peso - a.peso)
    .slice(0, 12);
}

/* ================= Flashcards ================= */
const INTERVALOS = [0, 1, 2, 4, 7]; // dias por caixa (prova próxima → intervalos curtos)
function cardsDevidos(filtro) {
  return FLASHCARDS.filter((c) => (!filtro || c.d === filtro) && (S.cards[c.id]?.due || '0000') <= hoje());
}
let fcAtual = null; let fcVerso = false; let fcFiltro = '';
function fcResponder(acertou) {
  const c = S.cards[fcAtual.id] || { box: 0 };
  c.box = acertou ? Math.min(c.box + 1, INTERVALOS.length - 1) : 0;
  c.due = addDias(hoje(), acertou ? INTERVALOS[c.box] : 0);
  if (!acertou) c.due = hoje();
  S.cards[fcAtual.id] = c;
  salvar();
  const fila = cardsDevidos(fcFiltro).filter((x) => x.id !== fcAtual.id || !acertou);
  fcAtual = acertou ? fila[0] || null : embaralhar(fila).find((x) => x.id !== fcAtual.id) || fcAtual;
  fcVerso = false; render();
}

/* ================= Simulado ================= */
let sim = null; // { questoes: [], respostas: {}, corrigido: false, inicio }
function gerarSimulado(discs, qtd, soErradas) {
  let pool = QUESTOES.filter((q) => discs.includes(q.d));
  if (soErradas) {
    const erradas = new Set(S.tentativas.filter((t) => t.qid && t.status !== 'acertou').map((t) => t.qid));
    pool = pool.filter((q) => erradas.has(q.id));
  }
  const escolhidas = embaralhar(pool).slice(0, qtd);
  // Questões com texto-base vêm primeiro e agrupadas, como na prova
  escolhidas.sort((x, y) => (y.t ? 1 : 0) - (x.t ? 1 : 0) || String(x.t || '').localeCompare(String(y.t || '')));
  sim = { questoes: escolhidas, respostas: {}, corrigido: false, inicio: Date.now() };
}
function corrigirSimulado() {
  sim.corrigido = true;
  sim.duracao = Math.round((Date.now() - sim.inicio) / 60000);
  sim.questoes.forEach((q) => {
    const resp = sim.respostas[q.id];
    S.tentativas.push({ data: hoje(), fonte: 'Simulado do app', d: q.d, a: q.a, qid: q.id, status: resp === q.r ? 'acertou' : 'errou' });
  });
  salvar();
}

/* ================= Registro manual ================= */
function acharDisc(txt) {
  const t = String(txt || '').trim().toLowerCase();
  if (DISCIPLINAS[t]) return t;
  const alias = { portugues: 'port', português: 'port', redacao: 'red', redação: 'red', constitucional: 'const', penal: 'penal', processual: 'pp', militar: 'pm', especial: 'esp', transito: 'trans', trânsito: 'trans', informatica: 'info', informática: 'info', institucional: 'inst' };
  if (alias[t]) return alias[t];
  return Object.keys(DISCIPLINAS).find((k) => DISCIPLINAS[k].nome.toLowerCase().includes(t)) || null;
}
function acharStatus(txt) {
  const t = String(txt || '').trim().toLowerCase();
  if (['a', 'c', 'certo', 'acertou', 'acerto', 'ok', '1'].includes(t)) return 'acertou';
  if (['e', 'errou', 'erro', 'x', '0'].includes(t)) return 'errou';
  if (['ch', 'chute', 'chutou', '?'].includes(t)) return 'chutou';
  return null;
}

/* ================= Render ================= */
const ABAS = [
  ['hoje', 'Hoje'], ['prova', 'Fazer prova'], ['cronograma', 'Cronograma'], ['simulado', 'Simulado'], ['registro', 'Registrar prova'],
  ['desempenho', 'Desempenho'], ['flashcards', 'Flashcards'], ['redacao', 'Redação'], ['dados', 'Dados'],
];
let aba = (() => { try { return localStorage.getItem('pmsc-aba') || 'hoje'; } catch { return 'hoje'; } })();
let mostrarPassados = false;

function chip(d) { return `<span class="chip" style="--c:${corD(d)}">${esc(nomeD(d))}</span>`; }

function viewTimer() {
  const t = S.timer;
  const opcoes = Object.keys(DISCIPLINAS).map((d) => `<option value="${d}" ${t?.d === d ? 'selected' : ''}>${esc(nomeD(d))}</option>`).join('');
  const rodando = t && t.fim;
  const ms = t ? timerRestante() : CONFIG.blocoMin * 60000;
  return `
  <section class="card timer ${t?.fase === 'pausa' ? 'pausa' : ''}">
    <div class="timer-topo">
      <span class="rotulo">${t ? (t.fase === 'foco' ? 'Foco' : 'Pausa') : 'Cronômetro'}</span>
      ${t && t.fase === 'foco' ? chip(t.d) : ''}
    </div>
    <div id="timer-display" class="timer-display">${pad(Math.floor(ms / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}</div>
    <div class="barra"><div id="timer-barra" style="width:${t ? 100 - (ms / t.totalMs) * 100 : 0}%"></div></div>
    <div class="timer-acoes">
      ${!t ? `<select id="timer-disc" aria-label="Disciplina">${opcoes}</select>` : ''}
      ${rodando ? '<button class="btn" data-acao="pausar">Pausar</button>' : `<button class="btn primario" data-acao="iniciar">${t ? 'Continuar' : 'Iniciar 50 min'}</button>`}
      ${t ? `<button class="btn" data-acao="encerrar">${t.fase === 'foco' ? 'Encerrar e salvar' : 'Pular pausa'}</button>` : ''}
    </div>
  </section>`;
}

function viewHoje() {
  const h = hoje();
  const faltam = difDias(h, CONFIG.prova);
  const blocos = blocosDoDia(h);
  const minHoje = S.sessoes.filter((s) => s.data === h).reduce((a, s) => a + s.min, 0);
  const devidos = cardsDevidos().length;
  const proximo = diasDeEstudo().find((d) => d > h);
  return `
  <div class="kpis">
    <div class="kpi"><b>${faltam > 0 ? faltam : 0}</b><span>dias para a prova (13/12)</span></div>
    <div class="kpi"><b>${fmtMin(minHoje)}</b><span>estudados hoje (meta 3h20 de foco)</span></div>
    <div class="kpi"><b>${devidos}</b><span>flashcards para revisar</span></div>
  </div>
  ${viewTimer()}
  <section class="card">
    <h2>Blocos de hoje · ${fmtData(h)}</h2>
    ${blocos.length ? `<ol class="blocos">${blocos.map((b, i) => `
      <li class="${S.feitos[b.chave] ? 'feito' : ''}">
        <span class="num">${i + 1}</span>
        <div class="info">${chip(b.d)}<p>${esc(b.assunto)}</p></div>
        <div class="acoes">
          <button class="btn pequeno primario" data-acao="iniciar-bloco" data-d="${b.d}" data-bloco="${b.chave}">▶</button>
          <label class="check"><input type="checkbox" data-acao="feito" data-bloco="${b.chave}" ${S.feitos[b.chave] ? 'checked' : ''}> feito</label>
        </div>
      </li>`).join('')}</ol>
      <p class="dica">Cada bloco: 50 min de foco + 10 min de pausa = 4h. Teoria rápida (15–20 min) e o resto em <b>questões</b>.</p>`
    : `<p>Hoje não tem bloco programado. ${proximo ? `Próximo dia de estudo: <b>${fmtData(proximo)}</b>.` : ''} Se tiver tempo: 20 min de flashcards ou 1 redação.</p>`}
  </section>`;
}

function viewCronograma() {
  const h = hoje();
  const dias = diasDeEstudo().filter((d) => mostrarPassados || d >= h);
  const semanas = {};
  dias.forEach((d) => { const w = semanaDe(d); (semanas[w] = semanas[w] || []).push(d); });
  return `
  <section class="card">
    <h2>Plano até a prova (seg a qui · 4 blocos/dia)</h2>
    <p class="dica">O peso das disciplinas segue o número de questões da prova: Legislação Institucional 10, Constitucional 8, Português 8, Penal/PP/Penal Militar/Especial 6 cada, Trânsito e Informática 5, mais Redação (20 pontos, mínimo 10).
    Os assuntos seguem o Anexo II do edital. Aprovação na objetiva: <b>mínimo de 30 pontos e nenhuma área zerada</b> (Direito, Legislação, Conhecimentos Comuns).</p>
    <label class="check"><input type="checkbox" data-acao="passados" ${mostrarPassados ? 'checked' : ''}> mostrar dias passados</label>
  </section>
  ${Object.entries(semanas).map(([w, ds]) => `
  <section class="card">
    <h3>Semana ${Number(w) + 1}${Number(w) === 3 ? ' · reta final (simulados + revisão)' : ''}</h3>
    <div class="tabela-scroll"><table class="crono">
      <thead><tr><th>Dia</th><th>Bloco 1</th><th>Bloco 2</th><th>Bloco 3</th><th>Bloco 4</th></tr></thead>
      <tbody>${ds.map((d) => `<tr class="${d === h ? 'hoje' : ''}"><td><b>${fmtData(d)}</b></td>${blocosDoDia(d).map((b) => `
        <td class="${S.feitos[b.chave] ? 'feito' : ''}">${chip(b.d)}<small>${esc(b.assunto)}</small></td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
  </section>`).join('')}
  <section class="card"><h3>Sex a dom</h3><p>Livres. Se der: 30 min de flashcards e 1 redação no fim de semana. <b>12/12 (sábado): descanso, sem matéria nova.</b></p></section>`;
}

function viewSimulado() {
  const contagem = {};
  QUESTOES.forEach((q) => { contagem[q.d] = (contagem[q.d] || 0) + 1; });
  if (!sim) {
    return `
    <section class="card">
      <h2>Gerar simulado</h2>
      <p class="dica">Banco com ${QUESTOES.length} questões originais (5 alternativas, como na AOCP). É para treinar, não substitui as provas oficiais. Peça mais questões no chat informando a disciplina e o assunto.</p>
      <div class="grade-check">${Object.keys(contagem).map((d) => `
        <label class="check"><input type="checkbox" name="sim-d" value="${d}" checked> ${esc(nomeD(d))} <small>(${contagem[d]})</small></label>`).join('')}</div>
      <div class="linha">
        <label>Quantidade <input type="number" id="sim-qtd" min="1" max="${QUESTOES.length}" value="15"></label>
        <label class="check"><input type="checkbox" id="sim-erradas"> só questões que já errei</label>
        <button class="btn primario" data-acao="gerar-sim">Gerar</button>
      </div>
    </section>`;
  }
  const acertos = sim.questoes.filter((q) => sim.respostas[q.id] === q.r).length;
  return `
  <section class="card">
    <div class="linha entre">
      <h2>Simulado · ${sim.questoes.length} questões</h2>
      <button class="btn" data-acao="sair-sim">${sim.corrigido ? 'Novo simulado' : 'Cancelar'}</button>
    </div>
    ${sim.corrigido ? `<p class="resultado">Resultado: <b>${acertos}/${sim.questoes.length}</b> (${pct(acertos, sim.questoes.length)}%) em ${sim.duracao} min. Os resultados foram salvos no Desempenho.</p>` : ''}
    ${!sim.questoes.length ? '<p>Nenhuma questão encontrada com esses filtros.</p>' : ''}
  </section>
  ${sim.questoes.map((q, i) => `
  <section class="card questao">
    <div class="q-topo">${chip(q.d)} <small>${esc(q.a)}</small></div>
    ${q.t && TEXTOS[q.t] ? `<details class="texto-base"><summary>Texto: ${esc(TEXTOS[q.t].titulo)}</summary>${TEXTOS[q.t].corpo.map((par) => `<p>${esc(par)}</p>`).join('')}<p class="dica">Texto original escrito para este simulado.</p></details>` : ''}
    <p><b>${i + 1}.</b> ${esc(q.e)}</p>
    <ol class="alts">${q.o.map((alt, j) => {
      let cls = '';
      if (sim.corrigido) { if (j === q.r) cls = 'certa'; else if (sim.respostas[q.id] === j) cls = 'errada'; }
      return `<li class="${cls}"><label><input type="radio" name="q-${q.id}" data-acao="responder" data-q="${q.id}" value="${j}" ${sim.respostas[q.id] === j ? 'checked' : ''} ${sim.corrigido ? 'disabled' : ''}> <b>${'ABCDE'[j]})</b> ${esc(alt)}</label></li>`;
    }).join('')}</ol>
    ${sim.corrigido ? `<p class="explicacao">${esc(q.x)}</p>` : ''}
  </section>`).join('')}
  ${sim.questoes.length && !sim.corrigido ? '<button class="btn primario largo" data-acao="corrigir-sim">Corrigir</button>' : ''}`;
}

function viewRegistro() {
  const opcoes = Object.keys(DISCIPLINAS).filter((d) => d !== 'rev').map((d) => `<option value="${d}">${esc(nomeD(d))}</option>`).join('');
  const recentes = S.tentativas.map((t, i) => ({ ...t, i })).filter((t) => t.fonte !== 'Simulado do app').slice(-30).reverse();
  return `
  <section class="card">
    <h2>Registrar questões de provas antigas</h2>
    <p class="dica">Use para o diagnóstico: faça as provas anteriores e lance cada questão. Marque "chutou" quando acertou sem ter certeza. Para o sistema, chute conta como ponto fraco.</p>
    <form id="form-registro" class="form">
      <label>Prova/fonte <input name="fonte" placeholder="Ex.: PMSC 2023" required></label>
      <label>Disciplina <select name="d">${opcoes}</select></label>
      <label>Assunto <input name="a" placeholder="Ex.: crase" required></label>
      <label>Resultado <select name="status"><option value="acertou">Acertou</option><option value="errou">Errou</option><option value="chutou">Chutou</option></select></label>
      <button class="btn primario">Adicionar</button>
    </form>
  </section>
  <section class="card">
    <h3>Lançar várias de uma vez</h3>
    <p class="dica">Uma questão por linha, no formato <code>disciplina;assunto;resultado</code>, em que o resultado é A (acertou), E (errou) ou CH (chutou).<br>Exemplo: <code>port;crase;E</code> · <code>constitucional;art. 5º;A</code> · <code>penal;legítima defesa;CH</code></p>
    <label>Prova/fonte <input id="lote-fonte" placeholder="Ex.: PMSC 2023"></label>
    <textarea id="lote-texto" rows="6" placeholder="port;crase;E&#10;port;concordância;A"></textarea>
    <button class="btn primario" data-acao="lote">Importar linhas</button>
    <p id="lote-msg" class="dica"></p>
  </section>
  <section class="card">
    <h3>Últimos lançamentos</h3>
    ${recentes.length ? `<div class="tabela-scroll"><table><thead><tr><th>Fonte</th><th>Disciplina</th><th>Assunto</th><th>Resultado</th><th></th></tr></thead><tbody>
    ${recentes.map((t) => `<tr><td>${esc(t.fonte)}</td><td>${chip(t.d)}</td><td>${esc(t.a)}</td><td class="st-${t.status}">${t.status}</td><td><button class="btn pequeno" data-acao="del-tent" data-i="${t.i}" aria-label="Excluir">✕</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p>Nada lançado ainda.</p>'}
  </section>`;
}

function viewDesempenho() {
  const st = statsPorDisciplina();
  const prio = prioridades();
  const totalMin = S.sessoes.reduce((a, s) => a + s.min, 0);
  const totalQ = S.tentativas.length;
  const totalA = S.tentativas.filter((t) => t.status === 'acertou').length;
  return `
  <div class="kpis">
    <div class="kpi"><b>${fmtMin(totalMin)}</b><span>de foco no total</span></div>
    <div class="kpi"><b>${totalQ}</b><span>questões registradas</span></div>
    <div class="kpi"><b>${pct(totalA, totalQ)}%</b><span>de acerto geral (mín. para aprovação: 50%)</span></div>
  </div>
  <section class="card">
    <h2>Prioridades de estudo</h2>
    <p class="dica">Ordenadas pela taxa de erro × peso da disciplina na prova.</p>
    ${prio.length ? `<ol class="prio">${prio.map((p) => `<li>${chip(p.d)} <b>${esc(p.a)}</b> <small>${p.erros}/${p.total} erros/chutes (${Math.round(p.taxa * 100)}%)</small></li>`).join('')}</ol>`
    : '<p>Registre provas antigas ou faça um simulado para gerar as prioridades.</p>'}
  </section>
  <section class="card">
    <h2>Por disciplina</h2>
    <div class="tabela-scroll"><table>
      <thead><tr><th>Disciplina</th><th>Na prova</th><th>Acerto</th><th>Questões</th><th>Estudo (semana / total)</th></tr></thead>
      <tbody>${Object.entries(st).filter(([d]) => d !== 'rev' || st[d].min).map(([d, s]) => `
        <tr><td>${chip(d)}</td><td>${DISCIPLINAS[d].questoes ? `${DISCIPLINAS[d].questoes} q` : esc(DISCIPLINAS[d].obs || '—')}</td>
        <td>${s.total ? `<div class="mini-barra"><div style="width:${pct(s.acertos, s.total)}%;background:${pct(s.acertos, s.total) >= 60 ? 'var(--ok)' : 'var(--erro)'}"></div></div> ${pct(s.acertos, s.total)}%` : '—'}</td>
        <td>${s.total}</td><td>${fmtMin(s.minSemana)} / ${fmtMin(s.min)}</td></tr>`).join('')}
      </tbody></table></div>
  </section>`;
}

function viewFlashcards() {
  const devidos = cardsDevidos(fcFiltro);
  if (!fcAtual || !devidos.find((c) => c.id === fcAtual.id)) { fcAtual = devidos[0] || null; fcVerso = false; }
  const discs = [...new Set(FLASHCARDS.map((c) => c.d))];
  return `
  <section class="card">
    <div class="linha entre">
      <h2>Flashcards · letra da lei</h2>
      <select id="fc-filtro" aria-label="Filtrar"><option value="">Todas (${cardsDevidos().length})</option>
        ${discs.map((d) => `<option value="${d}" ${fcFiltro === d ? 'selected' : ''}>${esc(nomeD(d))} (${cardsDevidos(d).length})</option>`).join('')}</select>
    </div>
    <p class="dica">Leia a pergunta, responda <b>em voz alta</b> e depois vire o cartão. Cartão acertado volta em 1, 2, 4 e 7 dias. Cartão errado volta hoje.</p>
  </section>
  ${fcAtual ? `
  <section class="card flash ${fcVerso ? 'verso' : ''}" data-acao="virar">
    ${chip(fcAtual.d)}
    <p class="frente">${esc(fcAtual.f)}</p>
    ${fcVerso ? `<p class="resposta">${esc(fcAtual.v)}</p>` : '<p class="dica">toque para ver a resposta</p>'}
  </section>
  ${fcVerso ? `<div class="linha centro"><button class="btn erro" data-acao="fc-errei">Errei</button><button class="btn ok" data-acao="fc-acertei">Acertei</button></div>` : ''}
  <p class="dica centro">${devidos.length} restantes hoje</p>`
  : '<section class="card"><p>Nenhum cartão para hoje. ✅</p></section>'}`;
}

function viewRedacao() {
  return `
  <section class="card">
    <h2>Redação · 20 pontos (mínimo 10)</h2>
    <p class="dica">Pelo edital (item 11): dissertação de <b>20 a 30 linhas</b>, a partir de texto motivador. A nota é <b>NPR = NC − (erros ÷ linhas)</b>. NC é o conteúdo (tema, argumentação, coesão, coerência, estrutura), até 20 pontos. Os erros contam ortografia, morfossintaxe e pontuação. Cada linha abaixo de 20 tira 0,2. Fuga ao tema ou qualquer identificação dá <b>nota zero</b>. Mínimo para aprovação: 10. Só é corrigida a redação de quem passar na objetiva e ficar até a <b>1.900ª posição na ampla concorrência</b> (ou 100ª nas vagas PcD).</p>
    <div class="linha"><button class="btn primario" data-acao="sortear-tema">Sortear tema</button></div>
    <p id="tema-sorteado" class="tema"></p>
  </section>
  <section class="card"><h3>Estrutura</h3>
    <ol class="estrutura">${REDACAO.estrutura.map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('')}</ol>
  </section>
  <section class="card"><h3>Checklist de revisão</h3>
    <ul class="checklist">${REDACAO.checklist.map((c) => `<li><label class="check"><input type="checkbox" class="ck-red"> ${esc(c)}</label></li>`).join('')}</ul>
    <p id="ck-total" class="dica"></p>
  </section>
  <section class="card"><h3>Registrar redação</h3>
    <form id="form-redacao" class="form">
      <label>Tema <input name="tema" required></label>
      <label>Linhas <input name="linhas" type="number" min="1" max="40"></label>
      <label>Nota estimada (0–20) <input name="nota" type="number" min="0" max="20" step="0.5"></label>
      <label class="largo">Observações / erros <input name="obs"></label>
      <button class="btn primario">Salvar</button>
    </form>
    ${S.redacoes.length ? `<div class="tabela-scroll"><table><thead><tr><th>Data</th><th>Tema</th><th>Linhas</th><th>Nota</th><th>Obs.</th></tr></thead><tbody>
    ${S.redacoes.slice().reverse().map((r) => `<tr><td>${fmtData(r.data)}</td><td>${esc(r.tema)}</td><td>${esc(r.linhas)}</td><td>${esc(r.nota)}</td><td>${esc(r.obs)}</td></tr>`).join('')}
    </tbody></table></div>` : ''}
    <p class="dica">Dica: escreva à mão, em folha pautada, cronometrando 60 min. Depois cole o texto no chat que eu corrijo pelos critérios.</p>
  </section>`;
}

function viewDados() {
  return `
  <div id="nuvem"></div>
  <section class="card">
    <h2>Backup dos dados</h2>
    <p class="dica">Tudo fica salvo neste navegador. Exporte de vez em quando. Este arquivo também vai servir para migrar os dados para o Supabase depois.</p>
    <div class="linha">
      <button class="btn primario" data-acao="exportar">Exportar JSON</button>
      <label class="btn">Importar JSON <input type="file" id="importar" accept="application/json" hidden></label>
      <button class="btn erro" data-acao="resetar">Apagar tudo</button>
    </div>
    <h3 style="margin-top:16px">Pelo texto (funciona na versão online)</h3>
    <p class="dica">Na versão online o download pode ser bloqueado. Use "Copiar JSON" e guarde o texto. Para restaurar, cole o JSON aqui e clique em "Importar texto".</p>
    <textarea id="json-dados" rows="5" placeholder="Cole aqui um backup JSON"></textarea>
    <div class="linha">
      <button class="btn" data-acao="copiar-json">Copiar JSON</button>
      <button class="btn" data-acao="importar-texto">Importar texto</button>
    </div>
    <p id="dados-msg" class="dica"></p>
  </section>`;
}

/* ================= Modo prova (folha de respostas) ================= */
const fmtTempo = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; };
function provaDecorrido() { const p = S.prova; return p ? (p.fim || Date.now()) - p.inicio : 0; }
function provaResumo() {
  const p = S.prova;
  const linhas = [];
  for (let i = p.de; i <= p.ate; i++) linhas.push(`${i}-${p.resp[i] || '_'}${p.duvida[i] ? '?' : ''}`);
  const respondidas = Object.keys(p.resp).length;
  return `${p.nome}\n${linhas.join('  ')}\nTempo: ${fmtTempo(provaDecorrido())} (${respondidas} respondidas, média ${fmtTempo(respondidas ? provaDecorrido() / respondidas : 0)} por questão)`;
}
function provaTick() {
  const p = S.prova; const el = $('#prova-tempo');
  if (!p || !el) return;
  const dec = provaDecorrido(); const limite = p.limiteMin * 60000;
  const respondidas = Object.keys(p.resp).length; const total = p.ate - p.de + 1;
  el.textContent = fmtTempo(dec);
  $('#prova-rest').textContent = dec <= limite ? `faltam ${fmtTempo(limite - dec)}` : `estourou ${fmtTempo(dec - limite)}`;
  $('#prova-media').textContent = respondidas ? fmtTempo(dec / respondidas) : '--:--';
  // Ritmo: quantas questões deveriam estar feitas até agora
  const esperado = Math.min(total, Math.floor(dec / (limite / total)));
  const ritmo = $('#prova-ritmo');
  ritmo.textContent = p.fim ? 'finalizada' : respondidas >= esperado ? 'no ritmo ✓' : `atrasado ${esperado - respondidas} questão(ões)`;
  ritmo.className = p.fim ? '' : respondidas >= esperado ? 'st-acertou' : 'st-errou';
  $('#prova-barra').style.width = `${Math.min(100, (dec / limite) * 100)}%`;
  $('#prova-barra').style.background = dec > limite ? 'var(--erro)' : 'var(--pri)';
  if (!p.avisou && dec >= limite && !p.fim) { p.avisou = true; salvar(); beep(); }
}
function viewProva() {
  const p = S.prova;
  if (!p) {
    return `
    <section class="card">
      <h2>Fazer prova com cronômetro</h2>
      <p class="dica">Resolva no PDF ou no papel e marque aqui só a letra. Use "?" nas questões em que ficou em dúvida. No fim, copie o resultado e mande no chat.</p>
      <form id="form-prova" class="form">
        <label class="largo">Prova <input id="pv-nome" name="nome" value="PM-PE 2024 · Português" required></label>
        <label>Da questão <input id="pv-de" name="de" type="number" min="1" value="1" required></label>
        <label>Até a questão <input id="pv-ate" name="ate" type="number" min="1" value="10" required></label>
        <label>Tempo (min) <input id="pv-min" name="min" type="number" min="1" value="30" required></label>
        <button class="btn primario">Começar</button>
      </form>
      <p class="dica">Referência: cerca de 3 min por questão (60 questões + redação em 5h na AOCP).</p>
    </section>`;
  }
  const total = p.ate - p.de + 1;
  const metaQ = (p.limiteMin * 60000) / total;
  const linhas = [];
  for (let i = p.de; i <= p.ate; i++) {
    linhas.push(`<li class="folha-linha ${p.resp[i] ? 'marcada' : ''}"><b>${i}</b>
      <div class="letras">${'ABCDE'.split('').map((l) => `<button class="letra ${p.resp[i] === l ? 'sel' : ''}" data-acao="pv-marcar" data-q="${i}" data-l="${l}" ${p.fim ? 'disabled' : ''} aria-label="Questão ${i} letra ${l}">${l}</button>`).join('')}
      <button class="letra duvida ${p.duvida[i] ? 'sel' : ''}" data-acao="pv-duvida" data-q="${i}" ${p.fim ? 'disabled' : ''} aria-label="Marcar dúvida na questão ${i}">?</button></div></li>`);
  }
  return `
  <section class="card prova-painel">
    <div class="linha entre"><h2>${esc(p.nome)}</h2><small class="dica">meta ${fmtTempo(metaQ)}/questão</small></div>
    <div class="prova-num">
      <div><span id="prova-tempo" class="timer-display">00:00</span><small id="prova-rest" class="dica"></small></div>
      <div class="prova-lado">
        <div><small class="dica">média por questão</small><b id="prova-media">--:--</b></div>
        <div><small class="dica">respondidas</small><b>${Object.keys(p.resp).length}/${total}</b></div>
        <div><small class="dica">ritmo</small><b id="prova-ritmo"></b></div>
      </div>
    </div>
    <div class="barra"><div id="prova-barra"></div></div>
  </section>
  <section class="card"><ol class="folha">${linhas.join('')}</ol></section>
  ${p.fim ? `
  <section class="card">
    <h3>Resultado para mandar no chat</h3>
    <textarea id="prova-txt" rows="4" readonly>${esc(provaResumo())}</textarea>
    <div class="linha"><button class="btn primario" data-acao="pv-copiar">Copiar</button><button class="btn" data-acao="pv-nova">Nova prova</button></div>
    <p id="pv-msg" class="dica"></p>
  </section>` : `
  <div class="linha"><button class="btn primario largo" data-acao="pv-finalizar">Finalizar prova</button></div>
  <div class="linha centro"><button class="btn pequeno" data-acao="pv-cancelar">Cancelar prova</button></div>`}`;
}

const VIEWS = { hoje: viewHoje, prova: viewProva, cronograma: viewCronograma, simulado: viewSimulado, registro: viewRegistro, desempenho: viewDesempenho, flashcards: viewFlashcards, redacao: viewRedacao, dados: viewDados };

function render() {
  $('#abas').innerHTML = ABAS.map(([k, n]) => `<button class="aba ${aba === k ? 'ativa' : ''}" data-aba="${k}">${n}</button>`).join('');
  $('#conteudo').innerHTML = VIEWS[aba]();
  timerTick();
  try { window.PMSC_aposRender?.(); } catch { /* sync opcional */ }
}

/* ================= Confirmação e backup ================= */
// O visualizador de artifacts bloqueia confirm()/alert(): confirmação em dois cliques.
function confirmar(el, texto) {
  if (el.dataset.armado === '1') return true;
  const original = el.textContent;
  el.dataset.armado = '1'; el.textContent = texto;
  setTimeout(() => { if (el.isConnected) { el.dataset.armado = ''; el.textContent = original; } }, 4000);
  return false;
}
function msgDados(t) { const m = $('#dados-msg'); if (m) m.textContent = t; }
function importarJSON(txt) {
  try {
    const dados = JSON.parse(txt);
    if (!Array.isArray(dados.sessoes) || !Array.isArray(dados.tentativas)) throw new Error('formato');
    S = { ...ESTADO_PADRAO, ...dados }; salvar(); render(); msgDados('Dados importados.');
  } catch { msgDados('Não consegui ler esse JSON. Confira se é um backup exportado por este app.'); }
}

/* ================= Eventos ================= */
document.addEventListener('click', (ev) => {
  const abaBtn = ev.target.closest('[data-aba]');
  if (abaBtn) { aba = abaBtn.dataset.aba; try { localStorage.setItem('pmsc-aba', aba); } catch { /* ignore */ } render(); window.scrollTo(0, 0); return; }
  const el = ev.target.closest('[data-acao]');
  if (!el) return;
  const acao = el.dataset.acao;
  switch (acao) {
    case 'iniciar': timerIniciar(S.timer?.d || $('#timer-disc')?.value || 'port'); break;
    case 'iniciar-bloco': timerIniciar(el.dataset.d, el.dataset.bloco); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
    case 'pausar': timerPausar(); break;
    case 'encerrar': timerEncerrar(); break;
    case 'gerar-sim': {
      const discs = [...document.querySelectorAll('input[name="sim-d"]:checked')].map((i) => i.value);
      gerarSimulado(discs, Math.max(1, Number($('#sim-qtd').value) || 10), $('#sim-erradas').checked);
      render(); break;
    }
    case 'corrigir-sim': {
      const faltam = sim.questoes.filter((q) => sim.respostas[q.id] === undefined).length;
      if (faltam && !confirmar(el, `${faltam} em branco contam como erro. Clique de novo para corrigir`)) break;
      corrigirSimulado(); render(); window.scrollTo(0, 0); break;
    }
    case 'sair-sim': if (sim.corrigido || confirmar(el, 'Clique de novo para descartar')) { sim = null; render(); } break;
    case 'lote': {
      const fonte = $('#lote-fonte').value.trim() || 'Prova antiga';
      let ok = 0; const falhas = [];
      $('#lote-texto').value.split('\n').map((l) => l.trim()).filter(Boolean).forEach((linha, n) => {
        const [dTxt, a, stTxt] = linha.split(';');
        const d = acharDisc(dTxt); const status = acharStatus(stTxt);
        if (d && status && a?.trim()) { S.tentativas.push({ data: hoje(), fonte, d, a: a.trim(), status }); ok++; } else falhas.push(n + 1);
      });
      salvar(); render();
      $('#lote-msg').textContent = `${ok} importada(s).${falhas.length ? ` Linhas com problema: ${falhas.join(', ')}.` : ''}`;
      break;
    }
    case 'del-tent': S.tentativas.splice(Number(el.dataset.i), 1); salvar(); render(); break;
    case 'virar': if (!fcVerso) { fcVerso = true; render(); } break;
    case 'fc-acertei': fcResponder(true); break;
    case 'fc-errei': fcResponder(false); break;
    case 'sortear-tema': $('#tema-sorteado').textContent = REDACAO.temas[Math.floor(Math.random() * REDACAO.temas.length)]; break;
    case 'exportar': {
      const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pmsc-estudos-${hoje()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000); break;
    }
    case 'resetar': if (confirmar(el, 'Clique de novo para apagar TUDO')) { S = { ...ESTADO_PADRAO }; salvar(); render(); } break;
    case 'copiar-json': {
      const ta = $('#json-dados'); ta.value = JSON.stringify(S);
      Promise.resolve().then(() => navigator.clipboard.writeText(ta.value))
        .then(() => msgDados('Copiado. Cole num arquivo .json ou numa nota para guardar.'))
        .catch(() => { ta.focus(); ta.select(); msgDados('Texto selecionado. Use Ctrl+C para copiar.'); });
      break;
    }
    case 'importar-texto': importarJSON($('#json-dados').value); break;
    case 'pv-marcar': {
      const q = el.dataset.q;
      if (S.prova.resp[q] === el.dataset.l) delete S.prova.resp[q]; else S.prova.resp[q] = el.dataset.l;
      salvar(); render(); break;
    }
    case 'pv-duvida': { const q = el.dataset.q; S.prova.duvida[q] = !S.prova.duvida[q]; salvar(); render(); break; }
    case 'pv-finalizar': {
      const faltam = S.prova.ate - S.prova.de + 1 - Object.keys(S.prova.resp).length;
      if (faltam && !confirmar(el, `${faltam} em branco. Clique de novo para finalizar`)) break;
      S.prova.fim = Date.now(); registrarSessao('port', Math.round(provaDecorrido() / 60000)); salvar(); render(); break;
    }
    case 'pv-cancelar': if (confirmar(el, 'Clique de novo para cancelar')) { S.prova = null; salvar(); render(); } break;
    case 'pv-nova': S.prova = null; salvar(); render(); break;
    case 'pv-copiar': {
      const ta = $('#prova-txt');
      Promise.resolve().then(() => navigator.clipboard.writeText(ta.value))
        .then(() => { $('#pv-msg').textContent = 'Copiado! Cole no chat.'; })
        .catch(() => { ta.focus(); ta.select(); $('#pv-msg').textContent = 'Texto selecionado. Use Ctrl+C.'; });
      break;
    }
    default: break;
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.acao === 'feito') { if (el.checked) S.feitos[el.dataset.bloco] = true; else delete S.feitos[el.dataset.bloco]; salvar(); render(); }
  if (el.dataset.acao === 'passados') { mostrarPassados = el.checked; render(); }
  if (el.dataset.acao === 'responder') { sim.respostas[el.dataset.q] = Number(el.value); }
  if (el.id === 'fc-filtro') { fcFiltro = el.value; fcAtual = null; render(); }
  if (el.classList.contains('ck-red')) {
    const n = document.querySelectorAll('.ck-red:checked').length;
    $('#ck-total').textContent = `${n}/${REDACAO.checklist.length} itens ok`;
  }
  if (el.id === 'importar' && el.files[0]) {
    el.files[0].text().then((txt) => {
      importarJSON(txt);
    });
  }
});

document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  if (ev.target.id === 'form-registro') {
    S.tentativas.push({ data: hoje(), fonte: f.get('fonte').trim(), d: f.get('d'), a: f.get('a').trim(), status: f.get('status') });
    salvar();
    const fonte = f.get('fonte'); const d = f.get('d');
    render();
    const form = $('#form-registro'); form.fonte.value = fonte; form.d.value = d; form.a.focus();
  }
  if (ev.target.id === 'form-prova') {
    const de = Number(f.get('de')); const ate = Number(f.get('ate'));
    if (ate < de) return;
    S.prova = { nome: f.get('nome').trim(), de, ate, limiteMin: Number(f.get('min')), inicio: Date.now(), fim: null, resp: {}, duvida: {} };
    salvar(); render();
  }
  if (ev.target.id === 'form-redacao') {
    S.redacoes.push({ data: hoje(), tema: f.get('tema').trim(), linhas: f.get('linhas'), nota: f.get('nota'), obs: f.get('obs').trim() });
    salvar(); render();
  }
});

setInterval(() => { timerTick(); provaTick(); }, 500);
render();
