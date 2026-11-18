// Sincronização na nuvem (Supabase): login por link mágico no e-mail e
// "última gravação vence" entre aparelhos. Sem config/biblioteca, não faz nada.
'use strict';
(function () {
  const cfg = window.PMSC_CONFIG;
  if (!cfg || !window.supabase || !window.PMSC) return;

  const sb = window.supabase.createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });
  const BACKUP_KEY = 'pmsc-estudos-backup-antes-sync';
  let usuario = null;
  let estado = 'deslogado'; // deslogado | sincronizando | ok | erro | link-enviado
  let msgErro = '';
  let timerEnvio = null;
  let aplicandoRemoto = false;

  const $ = (sel) => document.querySelector(sel);
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function setEstado(novo, erro = '') { estado = novo; msgErro = erro; pintar(); }

  function pintar() {
    const status = $('#nuvem-status');
    if (status) {
      const textos = {
        deslogado: '☁ Entrar para sincronizar',
        sincronizando: '☁ Sincronizando…',
        ok: '☁ Sincronizado',
        erro: '⚠ Sem sincronizar',
        'link-enviado': '☁ Confira seu e-mail',
      };
      status.textContent = textos[estado];
      status.className = `nuvem-status ${estado}`;
      status.title = estado === 'erro' ? msgErro : usuario ? usuario.email : 'Abrir a aba Dados para entrar';
    }
    const box = $('#nuvem');
    if (!box) return;
    if (usuario) {
      box.innerHTML = `
      <section class="card">
        <h2>Sincronização na nuvem</h2>
        <p>Conectado como <b>${esc(usuario.email)}</b>. Seus dados são salvos na nuvem e aparecem em qualquer aparelho em que você entrar com esse e-mail.</p>
        ${estado === 'erro' ? `<p class="st-errou">Não consegui sincronizar: ${esc(msgErro)}. Os dados continuam salvos neste aparelho.</p>` : ''}
        <div class="linha"><button class="btn" id="nuvem-agora">Sincronizar agora</button><button class="btn" id="nuvem-sair">Sair</button></div>
      </section>`;
    } else {
      box.innerHTML = `
      <section class="card">
        <h2>Sincronização na nuvem</h2>
        <p class="dica">Entre com seu e-mail para salvar na nuvem e usar no celular e no PC. Você recebe um link de acesso, sem senha.</p>
        <form id="nuvem-form" class="linha">
          <input id="nuvem-email" type="email" required placeholder="seu@email.com" autocomplete="email" aria-label="E-mail">
          <button class="btn primario">Enviar link</button>
        </form>
        ${estado === 'link-enviado' ? '<p class="st-acertou">Link enviado. Abra o e-mail <b>neste aparelho</b> e clique no link.</p>' : ''}
        ${estado === 'erro' ? `<p class="st-errou">${esc(msgErro)}</p>` : ''}
      </section>`;
    }
  }

  async function puxar() {
    if (!usuario) return;
    setEstado('sincronizando');
    const { data, error } = await sb.from('estudos').select('data, updated_at').eq('user_id', usuario.id).maybeSingle();
    if (error) return setEstado('erro', error.message);
    const local = window.PMSC.obter();
    const tsLocal = local._atualizadoEm || 0;
    if (!data) return enviar(); // primeira vez: sobe o que tem neste aparelho
    const remoto = data.data || {};
    const tsRemoto = remoto._atualizadoEm || Date.parse(data.updated_at) || 0;
    if (tsRemoto > tsLocal) {
      try { localStorage.setItem(BACKUP_KEY, JSON.stringify(local)); } catch { /* ignore */ }
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
    if (!usuario) return;
    setEstado('sincronizando');
    const { error } = await sb.from('estudos').upsert({ user_id: usuario.id, data: window.PMSC.obter(), updated_at: new Date().toISOString() });
    if (error) return setEstado('erro', error.message);
    setEstado('ok');
  }

  window.PMSC_onSalvar = () => {
    if (!usuario || aplicandoRemoto) return;
    clearTimeout(timerEnvio);
    timerEnvio = setTimeout(enviar, 1500);
  };
  window.PMSC_aposRender = pintar;

  document.addEventListener('submit', async (ev) => {
    if (ev.target.id !== 'nuvem-form') return;
    ev.preventDefault();
    const email = $('#nuvem-email').value.trim();
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) setEstado('erro', `Não consegui enviar o link: ${error.message}`);
    else setEstado('link-enviado');
  });
  document.addEventListener('click', async (ev) => {
    if (ev.target.id === 'nuvem-agora') puxar();
    if (ev.target.id === 'nuvem-sair') { await sb.auth.signOut(); }
    if (ev.target.id === 'nuvem-status' && !usuario) document.querySelector('[data-aba="dados"]')?.click();
  });
  // Ao voltar para a aba, busca o que foi feito em outro aparelho.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') puxar(); });
  window.addEventListener('beforeunload', () => { if (timerEnvio) { clearTimeout(timerEnvio); enviar(); } });

  sb.auth.onAuthStateChange((evento, sessao) => {
    const antes = usuario?.id;
    usuario = sessao?.user || null;
    if (!usuario) return setEstado('deslogado');
    if (usuario.id !== antes) setTimeout(puxar, 0); // fora do callback, como recomenda o supabase-js
  });
  pintar();
})();
