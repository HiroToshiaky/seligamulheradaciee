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
     sem internet, regras bloqueando etc.),
     cai automaticamente no modo local
     (localStorage) como reserva.
  ══════════════════════════════════ */
  const Metrics = (() => {
    // Mesma chave de "hoje" usada em TODO o módulo — Firebase e fallback local
    // usam exatamente o mesmo formato agora (antes um usava "today_" e o outro
    // "day_", o que fazia os números não baterem ao alternar entre os modos).
    function todayKey() {
      const d = new Date();
      return 'today_' + d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
    }

    async function init() {
      // Verifica se já contou uma visita na última hora (evita inflar o
      // contador em reloads/abas múltiplas da mesma pessoa)
      const lastVisitTime = Security.safeGet('last_visit_timestamp');
      const now = Date.now();
      const oneHourMs = 60 * 60 * 1000;

      if (lastVisitTime && (now - lastVisitTime) < oneHourMs) {
        if (window.firebaseDb && window.firebaseRef && window.firebaseOnValue) {
          try {
            const totalRef = window.firebaseRef(window.firebaseDb, 'visitors/total');
            window.firebaseOnValue(totalRef, snapshot => {
              updateBadge(snapshot.val());
            }, { onlyOnce: true });
          } catch (e) {
            console.error('Erro ao buscar total:', e);
          }
        }
        return;
      }

      // Aguarda o SDK do Firebase carregar (até 5s)
      let attempts = 0;
      while (!window.firebaseDb && attempts < 10) {
        console.log('Aguardando Firebase... tentativa', attempts + 1);
        await new Promise(r => setTimeout(r, 500));
        attempts++;
      }
      if (!window.firebaseDb) {
        console.log('Firebase não carregou após 5s, usando fallback local');
      }

      if (window.firebaseDb && window.firebaseRef && window.firebaseSet && window.firebaseOnValue) {
        try {
          const totalRef = window.firebaseRef(window.firebaseDb, 'visitors/total');
          const todayRef = window.firebaseRef(window.firebaseDb, 'visitors/' + todayKey());

          const totalSnap = await new Promise(resolve => {
            window.firebaseOnValue(totalRef, snapshot => resolve(snapshot), { onlyOnce: true });
          });
          const newTotal = (totalSnap.val() || 0) + 1;
          await window.firebaseSet(totalRef, newTotal);
          updateBadge(newTotal);

          const todaySnap = await new Promise(resolve => {
            window.firebaseOnValue(todayRef, snapshot => resolve(snapshot), { onlyOnce: true });
          });
          const newToday = (todaySnap.val() || 0) + 1;
          await window.firebaseSet(todayRef, newToday);

          Security.safeSet('last_visit_timestamp', Date.now());
          Security.safeSet('last_visit', new Date().toISOString());
          return;
        } catch (e) {
          console.error('Erro Firebase init:', e);
          // cai pro fallback abaixo
        }
      }

      // Fallback: localStorage (Firebase indisponível)
      const total = (Security.safeGet('total') || 0) + 1;
      Security.safeSet('total', total); // <- antes o valor incrementado nunca era salvo
      const todayLocal = (Security.safeGet(todayKey()) || 0) + 1;
      Security.safeSet(todayKey(), todayLocal);
      updateBadge(total);
      Security.safeSet('last_visit_timestamp', Date.now()); // <- antes usava uma variável inexistente (sessionId)
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

      // Depois tenta salvar no Firebase também
      if (window.firebaseDb && window.firebaseRef && window.firebaseSet && window.firebaseOnValue) {
        try {
          const ref = window.firebaseRef(window.firebaseDb, 'metrics/' + key);
          await new Promise((resolve, reject) => {
            window.firebaseOnValue(ref, snapshot => {
              const fbCurrent = snapshot.val() || 0;
              window.firebaseSet(ref, fbCurrent + 1).then(resolve).catch(reject);
            }, { onlyOnce: true });
          });
        } catch (e) {
          console.error('Erro ao incrementar métrica no Firebase:', e);
        }
      }
      await updateAdmin();
    }

    async function updateAdmin(preTotal, preToday) {
      const s = id => document.getElementById(id);

      let total = preTotal;
      let today = preToday;
      let complete = null;
      let shares = null;

      if (window.firebaseDb && window.firebaseRef && window.firebaseOnValue) {
        try {
          if (total === undefined || total === null) {
            const totalRef = window.firebaseRef(window.firebaseDb, 'visitors/total');
            total = await new Promise(resolve => {
              window.firebaseOnValue(totalRef, snapshot => resolve(snapshot.val()), { onlyOnce: true });
            });
          }
          if (today === undefined || today === null) {
            const todayRef = window.firebaseRef(window.firebaseDb, 'visitors/' + todayKey());
            today = await new Promise(resolve => {
              window.firebaseOnValue(todayRef, snapshot => resolve(snapshot.val()), { onlyOnce: true });
            });
          }

          const completeRef = window.firebaseRef(window.firebaseDb, 'metrics/completed');
          complete = await new Promise(resolve => {
            window.firebaseOnValue(completeRef, snapshot => resolve(snapshot.val()), { onlyOnce: true });
          });

          const sharesRef = window.firebaseRef(window.firebaseDb, 'metrics/shares');
          shares = await new Promise(resolve => {
            window.firebaseOnValue(sharesRef, snapshot => resolve(snapshot.val()), { onlyOnce: true });
          });
        } catch (e) {
          console.error('Erro Firebase admin:', e);
        }
      }

      // Fallback localStorage — só usa o valor local se o Firebase não respondeu
      // (checagem correta: null/undefined, não "falsy", pra não confundir 0 com "sem dado")
      if (total === undefined || total === null) total = Security.safeGet('total');
      if (today === undefined || today === null) today = Security.safeGet(todayKey());
      if (complete === undefined || complete === null) complete = Security.safeGet('completed');
      if (shares === undefined || shares === null) shares = Security.safeGet('shares');

      const last = Security.safeGet('last_visit');

      if(s('admin-total')) s('admin-total').textContent = total !== null && total !== undefined ? Number(total).toLocaleString('pt-BR') : '–';
      if(s('admin-today')) s('admin-today').textContent = today !== null && today !== undefined ? Number(today).toLocaleString('pt-BR') : '–';
      if(s('admin-complete')) s('admin-complete').textContent = complete !== null && complete !== undefined ? Number(complete).toLocaleString('pt-BR') : '–';
      if(s('admin-shares')) s('admin-shares').textContent = shares !== null && shares !== undefined ? Number(shares).toLocaleString('pt-BR') : '–';
      if(s('admin-last')) s('admin-last').textContent = last ? new Date(last).toLocaleString('pt-BR') : '–';
      if (total !== null && total !== undefined) updateBadge(total);
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
