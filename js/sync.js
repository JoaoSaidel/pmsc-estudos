// Sincronização na nuvem SEM login: todos os aparelhos usam o mesmo registro
// (PMSC_CONFIG.codigo). Regra: "última gravação vence" entre aparelhos.
'use strict';
(function () {
  const cfg = window.PMSC_CONFIG;
  if (!cfg || !window.supabase || !window.PMSC) return;

  const sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const BACKUP_KEY = 'pmsc-estudos-backup-antes-sync';
  const codigo = cfg.codigo;
  let estado = 'sincronizando'; // sincronizando | ok | erro
  let msgErro = '';
  let timerEnvio = null;
  let aplicandoRemoto = false;

  const $ = (sel) => document.querySelector(sel);
  const gravar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

  function setEstado(novo, erro = '') { estado = novo; msgErro = erro; pintar(); }

  function pintar() {
    const status = $('#nuvem-status');
    if (status) {
      status.textContent = { sincronizando: '☁ Sincronizando…', ok: '☁ Sincronizado', erro: '⚠ Sem sincronizar' }[estado];
      status.className = `nuvem-status ${estado}`;
      status.title = estado === 'erro' ? msgErro : 'Ver sincronização (aba Dados)';
    }
    const box = $('#nuvem');
    if (!box) return;
    box.innerHTML = `
    <section class="card">
      <h2>Sincronização na nuvem</h2>
      <p class="dica">Automática e sem login: abra este site em qualquer aparelho (celular, outro PC) e os dados aparecem. Não compartilhe o endereço do site, porque quem abrir pode ver e alterar seus dados.</p>
      ${estado === 'erro' ? `<p class="st-errou">Não consegui sincronizar: ${msgErro.replace(/[<>&]/g, '')}. Os dados continuam salvos neste aparelho.</p>` : ''}
      <div class="linha"><button class="btn" id="nuvem-agora">Sincronizar agora</button></div>
    </section>`;
  }

  async function puxar() {
    setEstado('sincronizando');
    const { data, error } = await sb.rpc('pmsc_ler', { p_codigo: codigo });
    if (error) return setEstado('erro', error.message);
    const linha = Array.isArray(data) ? data[0] : data;
    const local = window.PMSC.obter();
    const tsLocal = local._atualizadoEm || 0;
    if (!linha) return enviar(); // código novo: sobe o que tem neste aparelho
    const remoto = linha.data || {};
    const tsRemoto = remoto._atualizadoEm || Date.parse(linha.updated_at) || 0;
    if (tsRemoto > tsLocal) {
      gravar(BACKUP_KEY, JSON.stringify(local));
      aplicandoRemoto = true;
      window.PMSC.substituir(remoto);
      aplicandoRemoto = false;
      setEstado('ok');
    } else if (tsLocal > tsRemoto) {
      await enviar();
    } else {
      setEstado('ok');
    }
  }

  async function enviar() {
    setEstado('sincronizando');
    const { error } = await sb.rpc('pmsc_salvar', { p_codigo: codigo, p_data: window.PMSC.obter() });
    if (error) return setEstado('erro', error.message);
    setEstado('ok');
  }

  window.PMSC_onSalvar = () => {
    if (aplicandoRemoto) return;
    clearTimeout(timerEnvio);
    timerEnvio = setTimeout(() => { timerEnvio = null; enviar(); }, 1500);
  };
  window.PMSC_aposRender = pintar;

  document.addEventListener('click', (ev) => {
    if (ev.target.id === 'nuvem-agora') puxar();
    if (ev.target.id === 'nuvem-status') document.querySelector('[data-aba="dados"]')?.click();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') puxar(); });
  window.addEventListener('pagehide', () => { if (timerEnvio) { clearTimeout(timerEnvio); enviar(); } });

  pintar();
  puxar();
})();
