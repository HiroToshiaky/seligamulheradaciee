




/* ══════════════════════════════════
     SECURITY MODULE
  ══════════════════════════════════ */
  const Security = (() => {
    const RATE_WINDOW = 60000, MAX_ACTIONS = 9999;
    let actionLog = [];

    function checkRate() {
      const now = Date.now();
      actionLog = actionLog.filter(t => now - t < RATE_WINDOW);
      if (actionLog.length >= MAX_ACTIONS) return false;
      actionLog.push(now);
      return true;
    }

    function sanitize(str) {
      if (typeof str !== 'string') return '';
      return str
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#039;').slice(0, 500);
    }

    function safeKey(k) { return /^[a-zA-Z0-9_-]{1,64}$/.test(k); }

    function safeGet(key) {
      if (!safeKey(key)) return null;
      try { const v = localStorage.getItem('slm_' + key); return v ? JSON.parse(v) : null; }
      catch { return null; }
    }

    function safeSet(key, value) {
      if (!safeKey(key)) return false;
      try { localStorage.setItem('slm_' + key, JSON.stringify(value)); return true; }
      catch { return false; }
    }

    return { checkRate, sanitize, safeGet, safeSet };
  })();

  /* ══════════════════════════════════
     METRICS — Contador GLOBAL de verdade
     Usa a API pública CountAPI (gratuita,
     sem cadastro) para guardar o número
     num servidor — assim TODOS os
     visitantes do site, em qualquer
     computador ou celular, somam para o
     mesmo total. O localStorage só é
     usado como reserva (fallback) caso a
     API esteja fora do ar no momento.
  ══════════════════════════════════ */
  const Metrics = (() => {
    const NAMESPACE = 'seligamocada-concurso2026';
    const API = 'https://api.countapi.xyz';

    function todayKey() {
      const d = new Date();
      return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
    }

    async function hit(key) {
      // Incrementa um contador global no servidor do CountAPI.
      try {
        const res = await fetch(`${API}/hit/${NAMESPACE}/${key}`, { method: 'GET' });
        if (!res.ok) throw new Error('CountAPI indisponível');
        const data = await res.json();
        return typeof data.value === 'number' ? data.value : null;
      } catch {
        return null; // sem internet ou API fora do ar — usa fallback local
      }
    }

    async function get(key) {
      try {
        const res = await fetch(`${API}/get/${NAMESPACE}/${key}`, { method: 'GET' });
        if (!res.ok) throw new Error('CountAPI indisponível');
        const data = await res.json();
        return typeof data.value === 'number' ? data.value : null;
      } catch {
        return null;
      }
    }

    async function init() {
      // Total global de acessos — usa localStorage pra não travar
      const total = (Security.safeGet('total') || 0) + 1;
      Security.safeSet('total', total);

      // Acessos de hoje
      const today = (Security.safeGet('today_' + todayKey()) || 0) + 1;
      Security.safeSet('today_' + todayKey(), today);

      Security.safeSet('last_visit', new Date().toISOString());

      updateBadge(total);
      await updateAdmin(total, today);
    }

    function updateBadge(n) {
      const el = document.getElementById('visitor-count');
      if (el && n !== null) el.textContent = Number(n).toLocaleString('pt-BR');
    }

    async function inc(key) {
      await hit(key);
      await updateAdmin();
    }

    async function updateAdmin(preTotal, preToday) {
      const s = id => document.getElementById(id);
      const total = preTotal !== undefined ? preTotal : await get('total');
      const today = preToday !== undefined ? preToday : await get('day_' + todayKey());
      const complete = await get('completed');
      const shares = await get('shares');
      const last = Security.safeGet('last_visit');
      if(s('admin-total')) s('admin-total').textContent = total !== null ? Number(total).toLocaleString('pt-BR') : '–';
      if(s('admin-today')) s('admin-today').textContent = today !== null ? Number(today).toLocaleString('pt-BR') : '–';
      if(s('admin-complete')) s('admin-complete').textContent = complete !== null ? Number(complete).toLocaleString('pt-BR') : '–';
      if(s('admin-shares')) s('admin-shares').textContent = shares !== null ? Number(shares).toLocaleString('pt-BR') : '–';
      if(s('admin-last')) s('admin-last').textContent = last ? new Date(last).toLocaleString('pt-BR') : '–';
      if (total !== null) updateBadge(total);
    }

    return { init, inc, updateAdmin };
  })();

  /* ══════════════════════════════════
     NAVIGATION
  ══════════════════════════════════ */
  function showPage(id) {
    if (!Security.checkRate()) return;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const t = document.getElementById(id);
    if (t) { t.classList.add('active'); window.scrollTo({top:0,behavior:'smooth'}); }
  }

  // Corrige os links do menu: antes eles apontavam direto para #section-x,
  // que ficam escondidos quando a página do quiz está ativa (display:none),
  // então o navegador não conseguia rolar até lá. Agora primeiro voltamos
  // para a página inicial e só então rolamos até a seção.
  function goToSection(sectionId) {
    if (!Security.checkRate()) return;
    const homePage = document.getElementById('page-home');
    const wasHidden = !homePage.classList.contains('active');
    if (wasHidden) showPage('page-home');
    const scrollToTarget = () => {
      const el = document.getElementById(sectionId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    // Se trocamos de página agora, espera o layout assentar antes de rolar.
    if (wasHidden) setTimeout(scrollToTarget, 60);
    else scrollToTarget();
  }

  function toggleNavDrawer() {
    const drawer = document.getElementById('nav-drawer');
    const overlay = document.getElementById('nav-overlay');
    const btn = document.getElementById('hamburger-btn');
    const willOpen = !drawer.classList.contains('open');
    drawer.classList.toggle('open', willOpen);
    overlay.classList.toggle('open', willOpen);
    btn.classList.toggle('open', willOpen);
    btn.setAttribute('aria-expanded', willOpen);
  }

  /* ══════════════════════════════════
     ACESSIBILIDADE
  ══════════════════════════════════ */
  function toggleA11yPanel() {
    document.getElementById('a11y-panel').classList.toggle('open');
  }
  function toggleA11y(cls) {
    document.body.classList.toggle(cls);
    const state = {};
    ['a11y-big-text','a11y-contrast','a11y-underline-links'].forEach(c => state[c] = document.body.classList.contains(c));
    Security.safeSet('a11y_prefs', state);
  }
  function resetA11y() {
    ['a11y-big-text','a11y-contrast','a11y-underline-links'].forEach(c => document.body.classList.remove(c));
    Security.safeSet('a11y_prefs', {});
  }
  function loadA11yPrefs() {
    const state = Security.safeGet('a11y_prefs');
    if (!state) return;
    Object.keys(state).forEach(c => { if (state[c]) document.body.classList.add(c); });
  }

  function startExperience() {
    if (!Security.checkRate()) return;
    showPage('page-experience');
    startExpScreen(1);
  }

  /* ══════════════════════════════════
     EXPERIENCE ENGINE
  ══════════════════════════════════ */
  let currentScreen = 1;
  const TOTAL = 11;
  let quizScore = 0;
  const answered = {};

  function startExpScreen(n) {
    currentScreen = n;
    document.querySelectorAll('.exp-screen').forEach(s => s.classList.remove('active'));
    const t = document.getElementById('exp-' + n);
    if (t) t.classList.add('active');
    updateProgress(n);
    window.scrollTo({top: 60, behavior:'smooth'});
  }

  function nextExpScreen(n) {
    if (!Security.checkRate()) return;
    if (n > TOTAL) { Metrics.inc('completed'); return; }
    startExpScreen(n);
  }

  function updateProgress(n) {
    const pct = Math.round((n / TOTAL) * 100);
    const fill = document.getElementById('progress-fill');
    const text = document.getElementById('progress-text');
    const wrap = document.getElementById('progress-wrap');
    if (fill) fill.style.width = pct + '%';
    if (text) text.textContent = 'Etapa ' + n + ' de ' + TOTAL;
    if (wrap) wrap.setAttribute('aria-valuenow', n);
  }

  /* ══════════════════════════════════
     FEEDBACKS DAS ESCOLHAS
  ══════════════════════════════════ */
  const feedbacks = {
    2: {
      care:  { t:'⚠️ Atenção!', p:'Exigir localização e questionar cada saída é controle, não cuidado. Cuidado genuíno respeita a autonomia da outra pessoa.' },
      alert: { t:'✅ Você está no caminho certo.', p:'Sim, é um sinal de alerta. Controle constante da localização revela comportamento controlador que pode escalar.' },
      abuse: { t:'✅ Correto.', p:'Esse comportamento configura controle — violência psicológica prevista na Lei Maria da Penha. Mesmo sem agressão física, é abusivo.' }
    },
    3: {
      care:      { t:'⚠️ Atenção!', p:'Forçar o afastamento de amizades não é ciúme "normal". É isolamento — tática que aumenta a dependência e o controle.' },
      alert:     { t:'✅ Bem observado.', p:'O isolamento progressivo é um padrão clássico em relacionamentos abusivos. Um sinal que não deve ser ignorado.' },
      abuse:     { t:'✅ Correto.', p:'Pressionar alguém a se afastar de amigos e família é isolamento — forma de violência psicológica reconhecida na Lei Maria da Penha.' }
    },
    4: {
      desentendido: { t:'⚠️ Não exatamente.', p:'Negar o que aconteceu e fazer a vítima duvidar da própria memória tem um nome: gaslighting. É uma forma de violência psicológica.' },
      gaslighting:  { t:'✅ Correto!', p:'Gaslighting é manipulação psicológica que faz a vítima duvidar da própria percepção da realidade. É uma das "violências invisíveis" mais comuns.' },
      mansplaining: { t:'⚠️ Quase!', p:'Mansplaining é quando um homem explica algo condescendentemente a uma mulher. O que aconteceu aqui foi gaslighting — negar a realidade da vítima.' }
    }
  };

  function handleChoice(screenNum, choice) {
    if (!Security.checkRate()) return;
    const fb = document.getElementById('fb-' + screenNum);
    const nextBtn = document.getElementById('next-' + screenNum);
    const data = feedbacks[screenNum] && feedbacks[screenNum][choice];
    if (fb && data) {
      fb.innerHTML = '<h3>' + Security.sanitize(data.t) + '</h3><p>' + Security.sanitize(data.p) + '</p>';
      fb.classList.add('visible');
    }
    if (nextBtn) nextBtn.style.display = 'inline-flex';
    document.querySelectorAll('#exp-' + screenNum + ' .choice-btn').forEach(b => {
      b.disabled = true; b.style.opacity = '.55';
    });
  }

  /* ══════════════════════════════════
     QUIZ FINAL
  ══════════════════════════════════ */
  function answerQuiz(qid, btn, result) {
    if (!Security.checkRate()) return;
    if (answered[qid]) return;
    answered[qid] = true;
    btn.classList.add(result);
    if (result === 'correct') quizScore++;
    document.getElementById(qid).querySelectorAll('.quiz-opt').forEach(b => b.disabled = true);
    if (Object.keys(answered).length === 3) showQuizScore();
  }

  function showQuizScore() {
    const sc = document.getElementById('quiz-score');
    const nm = document.getElementById('score-num');
    const mg = document.getElementById('score-msg');
    const nb = document.getElementById('next-9');
    if(sc) sc.style.display = 'block';
    if(nm) nm.textContent = quizScore + '/3';
    const msgs = [
      'Continue aprendendo — cada leitura faz diferença. Vale refazer!',
      'Você está reconhecendo os padrões. Com informação, fica mais fácil identificar.',
      '🌟 Parabéns! Você reconheceu todos os sinais. Compartilhe essa campanha!'
    ];
    if(mg) mg.textContent = msgs[quizScore] || msgs[2];
    if(nb) nb.style.display = 'inline-flex';
    if(quizScore === 3) Metrics.inc('completed');
  }

  /* ══════════════════════════════════
     CARD TOGGLE
  ══════════════════════════════════ */
  function toggleCard(el) {
    el.classList.toggle('open');
    el.setAttribute('aria-expanded', el.classList.contains('open'));
  }

  /* ══════════════════════════════════
     SHARE
  ══════════════════════════════════ */
  function shareWhatsApp() {
    if (!Security.checkRate()) return;
    Metrics.inc('shares');
    const msg = encodeURIComponent(
      '🎗️ Se Liga Moçada — Campanha contra o Machismo e a Violência contra a Mulher\n\n' +
      '"Informação, conscientização e prevenção são ferramentas para combater o machismo."\n\n' +
      'Faça o quiz e aprenda a reconhecer os sinais:\n' + window.location.href
    );
    window.open('https://wa.me/?text=' + msg, '_blank', 'noopener,noreferrer');
  }

  function copyLink() {
    if (!Security.checkRate()) return;
    Metrics.inc('shares');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href).then(() => alert('✅ Link copiado! Compartilhe.'));
    } else {
      const inp = document.createElement('input');
      inp.value = window.location.href;
      inp.style.position = 'absolute'; inp.style.left = '-9999px';
      document.body.appendChild(inp); inp.select(); document.execCommand('copy');
      document.body.removeChild(inp); alert('✅ Link copiado!');
    }
  }

  function restart() {
    if (!Security.checkRate()) return;
    quizScore = 0;
    Object.keys(answered).forEach(k => delete answered[k]);
    document.querySelectorAll('.feedback-box').forEach(f => { f.innerHTML=''; f.classList.remove('visible'); });
    document.querySelectorAll('.choice-btn').forEach(b => { b.disabled=false; b.style.opacity='1'; });
    document.querySelectorAll('.quiz-opt').forEach(b => { b.disabled=false; b.classList.remove('correct','wrong'); });
    document.querySelectorAll('[id^="next-"]').forEach(b => b.style.display='none');
    const qs = document.getElementById('quiz-score'); if(qs) qs.style.display='none';
    document.querySelectorAll('.card-type').forEach(c => { c.classList.remove('open'); c.removeAttribute('aria-expanded'); });
    startExpScreen(1);
  }

  /* ══════════════════════════════════
     ADMIN
  ══════════════════════════════════ */
  let adminOpen = false;
  function toggleAdmin() {
    adminOpen = !adminOpen;
    const p = document.getElementById('admin-panel');
    if(p) { p.style.display = adminOpen ? 'block':'none'; if(adminOpen) Metrics.updateAdmin(); }
  }

  /* FRAME GUARD */
  if (window.top !== window.self) {
    document.body.innerHTML = '<p style="padding:20px;font-family:sans-serif">Este site não pode ser exibido em iframe por motivos de segurança.</p>';
  }

  /* KEYBOARD */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (adminOpen) toggleAdmin();
      const drawer = document.getElementById('nav-drawer');
      if (drawer && drawer.classList.contains('open')) toggleNavDrawer();
      const a11yPanel = document.getElementById('a11y-panel');
      if (a11yPanel && a11yPanel.classList.contains('open')) a11yPanel.classList.remove('open');
    }
  });

  /* ══════════════════════════════════
     VIDEOS POPUP COM NAVEGAÇÃO
  ══════════════════════════════════ */
  let currentVideoIdx = 1;
  let touchStartX = 0;
  let availableVideos = [];
  
  function openVideosModal() {
    if (!Security.checkRate()) return;
    const totalVideos = 3; // MUDE AQUI: quantos vídeos você tem (1 a 5)
    availableVideos = [];
    for (let i = 1; i <= totalVideos; i++) availableVideos.push(i);
    if (availableVideos.length === 0) {
      alert('Nenhum vídeo disponível.');
      return;
    }
    currentVideoIdx = availableVideos[0];
    showVideoPopup();
  }
  
  function showVideoPopup() {
    const existing = document.getElementById('video-popup-modal');
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = 'video-popup-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.95);display:flex;align-items:center;justify-content:center;z-index:10000;padding:20px';
    
    const currentIdx = availableVideos.indexOf(currentVideoIdx);
    let navHtml = '';
    if (currentIdx > 0) navHtml += '<button onclick="prevVideo()" style="position:absolute;left:20px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.2);border:none;color:#fff;font-size:36px;cursor:pointer;width:50px;height:50px;border-radius:50%;display:flex;align-items:center;justify-content:center">‹</button>';
    if (currentIdx < availableVideos.length - 1) navHtml += '<button onclick="nextVideo()" style="position:absolute;right:20px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.2);border:none;color:#fff;font-size:36px;cursor:pointer;width:50px;height:50px;border-radius:50%;display:flex;align-items:center;justify-content:center">›</button>';
    
    modal.innerHTML = '<div style="position:relative;max-width:90vw;max-height:90vh;width:100%" id="video-container" ontouchstart="touchStart(event)" ontouchend="touchEnd(event)">' + navHtml + '<button onclick="closeVideoPopup()" style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,.5);border:none;color:#fff;font-size:32px;cursor:pointer;width:45px;height:45px;border-radius:50%;z-index:10001">×</button><video id="video-player" width="100%" height="100%" controls autoplay style="border-radius:8px;display:block"><source src="videos/video-' + currentVideoIdx + '.mp4" type="video/mp4">Seu navegador não suporta vídeos.</video><p style="color:#fff;text-align:center;margin-top:16px;font-size:14px">Vídeo ' + (currentIdx + 1) + ' de ' + availableVideos.length + '</p></div>';
    
    document.body.appendChild(modal);
  }
  
  function nextVideo() {
    const currentIdx = availableVideos.indexOf(currentVideoIdx);
    if (currentIdx < availableVideos.length - 1) {
      currentVideoIdx = availableVideos[currentIdx + 1];
      showVideoPopup();
    }
  }
  
  function prevVideo() {
    const currentIdx = availableVideos.indexOf(currentVideoIdx);
    if (currentIdx > 0) {
      currentVideoIdx = availableVideos[currentIdx - 1];
      showVideoPopup();
    }
  }
  
  function closeVideoPopup() {
    const modal = document.getElementById('video-popup-modal');
    if (modal) modal.remove();
  }
  
  function touchStart(e) {
    touchStartX = e.touches[0].clientX;
  }
  
  function touchEnd(e) {
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX - touchEndX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) nextVideo();
      else prevVideo();
    }
  }

  /* INIT */
  document.addEventListener('DOMContentLoaded', () => { Metrics.init(); loadA11yPrefs(); });
