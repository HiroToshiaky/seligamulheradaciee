/* ══════════════════════════════════
     SECURITY MODULE
  ══════════════════════════════════ */
  const Security = (() => {
    const RATE_WINDOW = 60000, MAX_ACTIONS = 60;
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
     METRICS — Contador GLOBAL via Firebase
     Realtime Database. Se o Firebase não
     estiver disponível (SDK não carregou,
     sem internet, permissão negada etc.),
     cai automaticamente no modo local
     (localStorage) como reserva.

     IMPORTANTE: toda leitura/escrita tem um
     TIMEOUT e trata erro de permissão de
     verdade. Antes, se o Firebase negasse o
     acesso (ex: regra de segurança bloqueando),
     a chamada não dava erro nem retornava nada
     — só ficava travada pra sempre, esperando
     algo que nunca chegava, e por isso os
     números ficavam presos em "–" do nada.
  ══════════════════════════════════ */
  const Metrics = (() => {
    const TIMEOUT_MS = 4000;

    function todayKey() {
      const d = new Date();
      return 'today_' + d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
    }

    // Lê um valor uma única vez, com timeout e tratamento de erro de
    // permissão — nunca fica pendurada esperando pra sempre.
    function readOnce(path) {
      return new Promise((resolve, reject) => {
        if (!window.firebaseDb || !window.firebaseRef || !window.firebaseOnValue) {
          reject(new Error('Firebase indisponível'));
          return;
        }
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error('Timeout lendo ' + path));
        }, TIMEOUT_MS);
        try {
          const r = window.firebaseRef(window.firebaseDb, path);
          window.firebaseOnValue(
            r,
            snapshot => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve(snapshot.val());
            },
            error => {
              // Isso é o que faltava: erro de permissão agora É um erro de
              // verdade (rejeita a promise), em vez de nunca chamar nada.
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              console.error('Firebase negou leitura de', path, error);
              reject(error);
            },
            { onlyOnce: true }
          );
        } catch (e) {
          if (!settled) { settled = true; clearTimeout(timer); reject(e); }
        }
      });
    }

    // Escreve um valor, com timeout — se travar, não bloqueia o resto do site.
    function writeOnce(path, value) {
      if (!window.firebaseDb || !window.firebaseRef || !window.firebaseSet) {
        return Promise.reject(new Error('Firebase indisponível'));
      }
      const r = window.firebaseRef(window.firebaseDb, path);
      return Promise.race([
        window.firebaseSet(r, value),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout escrevendo ' + path)), TIMEOUT_MS))
      ]);
    }

    async function init() {
      // Verifica se já contou uma visita na última hora (evita inflar o
      // contador em reloads/abas múltiplas da mesma pessoa)
      const lastVisitTime = Security.safeGet('last_visit_timestamp');
      const now = Date.now();
      const oneHourMs = 60 * 60 * 1000;

      if (lastVisitTime && (now - lastVisitTime) < oneHourMs) {
        readOnce('visitors/total').then(updateBadge).catch(() => {
          // sem sorte agora — mantém o que já estiver na tela
        });
        return;
      }

      // Aguarda o SDK do Firebase carregar (até 5s)
      let attempts = 0;
      while (!window.firebaseDb && attempts < 10) {
        await new Promise(r => setTimeout(r, 500));
        attempts++;
      }

      if (window.firebaseDb) {
        try {
          const currentTotal = await readOnce('visitors/total');
          const newTotal = (currentTotal || 0) + 1;
          writeOnce('visitors/total', newTotal).catch(e => console.error('Erro ao salvar total:', e));
          updateBadge(newTotal);

          const currentToday = await readOnce('visitors/' + todayKey());
          const newToday = (currentToday || 0) + 1;
          writeOnce('visitors/' + todayKey(), newToday).catch(e => console.error('Erro ao salvar today:', e));

          Security.safeSet('last_visit_timestamp', Date.now());
          Security.safeSet('last_visit', new Date().toISOString());
          return;
        } catch (e) {
          console.error('Firebase indisponível no init, usando fallback local:', e);
          // cai pro fallback abaixo
        }
      }

      // Fallback: localStorage (Firebase indisponível)
      const total = (Security.safeGet('total') || 0) + 1;
      Security.safeSet('total', total);
      const todayLocal = (Security.safeGet(todayKey()) || 0) + 1;
      Security.safeSet(todayKey(), todayLocal);
      updateBadge(total);
      Security.safeSet('last_visit_timestamp', Date.now());
      Security.safeSet('last_visit', new Date().toISOString());
    }

    function updateBadge(n) {
      const el = document.getElementById('visitor-count');
      if (el && n !== null && n !== undefined) el.textContent = Number(n).toLocaleString('pt-BR');
    }

    async function inc(key) {
      // Incrementa no localStorage imediatamente (resposta instantânea na tela)
      const current = (Security.safeGet(key) || 0);
      Security.safeSet(key, current + 1);

      // Depois tenta salvar no Firebase também — se falhar/travar, o valor
      // local já está salvo, então nada se perde.
      try {
        const fbCurrent = await readOnce('metrics/' + key);
        await writeOnce('metrics/' + key, (fbCurrent || 0) + 1);
      } catch (e) {
        console.error('Erro ao incrementar métrica no Firebase:', e);
      }
      await updateAdmin();
    }

    async function updateAdmin(preTotal, preToday) {
      const s = id => document.getElementById(id);

      // Cada leitura é independente: se uma travar/falhar, as outras não são
      // afetadas — antes, um erro em qualquer uma delas deixava TODAS as
      // outras em "–", mesmo as que teriam funcionado normalmente.
      const [total, today, complete, shares] = await Promise.all([
        preTotal !== undefined && preTotal !== null ? Promise.resolve(preTotal) : readOnce('visitors/total').catch(() => null),
        preToday !== undefined && preToday !== null ? Promise.resolve(preToday) : readOnce('visitors/' + todayKey()).catch(() => null),
        readOnce('metrics/completed').catch(() => null),
        readOnce('metrics/shares').catch(() => null),
      ]);

      // Fallback localStorage — só usa o valor local se o Firebase não respondeu
      const finalTotal = total !== null && total !== undefined ? total : Security.safeGet('total');
      const finalToday = today !== null && today !== undefined ? today : Security.safeGet(todayKey());
      const finalComplete = complete !== null && complete !== undefined ? complete : Security.safeGet('completed');
      const finalShares = shares !== null && shares !== undefined ? shares : Security.safeGet('shares');
      const last = Security.safeGet('last_visit');

      if(s('admin-total')) s('admin-total').textContent = finalTotal !== null && finalTotal !== undefined ? Number(finalTotal).toLocaleString('pt-BR') : '–';
      if(s('admin-today')) s('admin-today').textContent = finalToday !== null && finalToday !== undefined ? Number(finalToday).toLocaleString('pt-BR') : '–';
      if(s('admin-complete')) s('admin-complete').textContent = finalComplete !== null && finalComplete !== undefined ? Number(finalComplete).toLocaleString('pt-BR') : '–';
      if(s('admin-shares')) s('admin-shares').textContent = finalShares !== null && finalShares !== undefined ? Number(finalShares).toLocaleString('pt-BR') : '–';
      if(s('admin-last')) s('admin-last').textContent = last ? new Date(last).toLocaleString('pt-BR') : '–';
      if (finalTotal !== null && finalTotal !== undefined) updateBadge(finalTotal);
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

  async function openVideosModal() {
    if (!Security.checkRate()) return;

    // Detecta automaticamente quais vídeos existem (video-1.mp4, video-2.mp4...)
    // até achar o primeiro que não existe.
    availableVideos = [];
    for (let i = 1; i <= 5; i++) {
      try {
        const res = await fetch('videos/video-' + i + '.mp4', { method: 'HEAD' });
        if (res.ok) {
          availableVideos.push(i);
        } else {
          break;
        }
      } catch {
        break;
      }
    }
    // (removido o trecho que refazia essa mesma lista do zero logo em seguida —
    // era redundante, availableVideos já está pronta aqui)

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
    if (currentIdx > 0) navHtml += '<button onclick="prevVideo()" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.3);border:none;color:#fff;font-size:28px;cursor:pointer;width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;z-index:10002">‹</button>';
    if (currentIdx < availableVideos.length - 1) navHtml += '<button onclick="nextVideo()" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.3);border:none;color:#fff;font-size:28px;cursor:pointer;width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;z-index:10002">›</button>';

    modal.innerHTML = '<div style="position:relative;width:100%;max-width:800px;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden" id="video-container" ontouchstart="touchStart(event)" ontouchend="touchEnd(event)">' + navHtml + '<button onclick="closeVideoPopup()" style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,.6);border:none;color:#fff;font-size:28px;cursor:pointer;width:40px;height:40px;border-radius:50%;z-index:10003;display:flex;align-items:center;justify-content:center">×</button><div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px">⏳ Carregando...</div></div><p style="color:#fff;text-align:center;margin-top:12px;font-size:13px">Vídeo ' + (currentIdx + 1) + ' de ' + availableVideos.length + '</p>';

    document.body.appendChild(modal);

    setTimeout(() => {
      const container = document.getElementById('video-container');
      if (container) {
        container.innerHTML = navHtml + '<button onclick="closeVideoPopup()" style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,.6);border:none;color:#fff;font-size:28px;cursor:pointer;width:40px;height:40px;border-radius:50%;z-index:10003;display:flex;align-items:center;justify-content:center">×</button><video width="100%" height="100%" controls autoplay style="border-radius:8px;display:block;object-fit:contain"><source src="videos/video-' + currentVideoIdx + '.mp4" type="video/mp4"></video>';
      }
    }, 100);
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

  /* VIDEO PRELOAD */
  function startVideoPreload() {
    for (let i = 1; i <= 3; i++) {
      const video = document.getElementById('preload-video-' + i);
      if (video) {
        video.load();
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(startVideoPreload, 100);
  });

  window.addEventListener('load', () => {
    startVideoPreload();
  });