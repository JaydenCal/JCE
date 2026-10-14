(function () {
  'use strict';
  document.documentElement.classList.add('js');
  var windowPanel = document.getElementById('modelWindow');
  var panels = Array.from(document.querySelectorAll('[data-model-panel]'));
  var modelStatus = document.getElementById('modelStatus');
  var opener, modelLoad, activeName, pushedEntry = false, leavingForAnchor = false;
  var categories = {
    digital: {id: 'plans-to-model', service: 'Development civil package', project: ''},
    residential: {id: 'house-model', service: 'Stormwater plan', project: 'New house or granny flat'},
    commercial: {id: 'commercial-model', service: 'Development civil package', project: 'Commercial or industrial'},
    subdivision: {id: 'subdivision', service: 'Subdivision design', project: 'Subdivision'}
  };
  function script(path) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script'); el.src = path + '?v=20261006-18';
      el.onload = resolve; el.onerror = reject; document.body.appendChild(el);
    });
  }
  function models() {
    if (!modelLoad) modelLoad = script('assets/three-r128.min.js').then(function () {
      return script('jce-models.js');
    }).catch(function () {
      document.documentElement.classList.add('no3d');
      var message = document.createElement('p'); message.className = 'scope-note';
      message.textContent = 'The interactive models are unavailable in this browser. You can still explore the services and request a fee proposal.';
      windowPanel.querySelector('.model-window-body').prepend(message);
      modelStatus.hidden = true;
    });
    return modelLoad;
  }
  function openModel(name, trigger) {
    if (!categories[name] || !windowPanel) return;
    if (!windowPanel.open) opener = trigger || document.activeElement;
    activeName = name;
    modelStatus.textContent = 'Loading the ' + (name === 'digital' ? 'project' : name) + ' model…'; modelStatus.hidden = document.documentElement.classList.contains('no3d');
    panels.forEach(function (panel) { panel.hidden = panel.getAttribute('data-model-panel') !== name; });
    if (name === 'digital') requestAnimationFrame(function () { window.dispatchEvent(new Event('resize')); });
    var selected = document.getElementById(categories[name].id);
    document.getElementById('modelWindowTitle').textContent = selected.getAttribute('data-window-title');
    windowPanel.querySelectorAll('.model-switcher button').forEach(function (button) {
      button.setAttribute('aria-pressed', button.getAttribute('data-model-open') === name ? 'true' : 'false');
    });
    var quote = document.getElementById('modelQuote');
    quote.setAttribute('data-offer', categories[name].service);
    quote.setAttribute('data-project', categories[name].project);
    document.documentElement.classList.add('model-window-open');
    if (!windowPanel.open) {
      if (windowPanel.showModal) windowPanel.showModal(); else windowPanel.setAttribute('open', '');
      windowPanel.querySelector('.model-close').focus();
    }
    windowPanel.querySelector('.model-window-body').scrollTop = 0;
    models().then(function () {
      if (windowPanel.open && activeName === name) document.dispatchEvent(new CustomEvent('jce:model-open', {detail: {name: name}}));
    });
  }
  function afterClose() {
    if (windowPanel.open) return;
    document.documentElement.classList.remove('model-window-open');
    document.dispatchEvent(new CustomEvent('jce:model-close'));
    if (opener && opener.isConnected) opener.focus({preventScroll: true});
    var ours = pushedEntry && history.state && history.state.jceModel === true;
    pushedEntry = false;
    if (ours && !leavingForAnchor) { history.back(); return; }
    leavingForAnchor = false;
    if (['#plans-to-model','#house-model','#commercial-model','#subdivision','#site-model'].indexOf(location.hash) !== -1) history.replaceState(null, '', location.pathname + location.search);
  }
  document.addEventListener('jce:model-ready', function (event) {
    if (event.detail.name === activeName) modelStatus.hidden = true;
  });
  function closeModel() {
    if (!windowPanel || !windowPanel.open) return;
    if (windowPanel.close) windowPanel.close(); else { windowPanel.removeAttribute('open'); afterClose(); }
  }
  if (windowPanel) {
    windowPanel.querySelector('.model-close').addEventListener('click', closeModel);
    windowPanel.addEventListener('close', afterClose);
    windowPanel.addEventListener('click', function (event) {
      if (event.target !== windowPanel) return;
      var bounds = windowPanel.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeModel();
    });
    windowPanel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !windowPanel.showModal) closeModel();
      if (event.key !== 'Tab') return;
      var stops = Array.from(windowPanel.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]')).filter(function (element) {
        return element.getAttribute('tabindex') !== '-1' && element.getClientRects().length > 0;
      });
      if (!stops.length) return;
      var first = stops[0], last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }
  function reveal(target) {
    for (var parent = target.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
  }
  document.addEventListener('click', function (event) {
    var modelAction = event.target.closest('[data-model-open]');
    if (modelAction && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
      event.preventDefault();
      var chosen = modelAction.getAttribute('data-model-open');
      if (categories[chosen] && windowPanel) {
        try {
          if (windowPanel.open) history.replaceState({jceModel: true}, '', '#' + categories[chosen].id);
          else { history.pushState({jceModel: true}, '', '#' + categories[chosen].id); pushedEntry = true; }
        } catch (_) {}
      }
      openModel(chosen, modelAction); return;
    }
    var anchor = event.target.closest('a[href^="#"]');
    if (!anchor) return;
    var target = document.getElementById(anchor.getAttribute('href').slice(1));
    if (!target) return;
    if (windowPanel && windowPanel.open && windowPanel.contains(anchor)) {
      event.preventDefault(); leavingForAnchor = true; closeModel();
      requestAnimationFrame(function () {
        target.scrollIntoView({block: 'start', behavior: 'auto'});
        var field = target.querySelector('input:not([type="hidden"])');
        (field || target).focus({preventScroll: true});
      });
      return;
    }
    var hidden = !!target.closest('details:not([open])'); reveal(target);
    if (hidden) {
      event.preventDefault(); history.pushState(null, '', anchor.getAttribute('href'));
      requestAnimationFrame(function () { target.scrollIntoView({block: 'start', behavior: 'auto'}); });
    }
    var menu = anchor.closest('details.mnav, details.bar-menu'); if (menu) menu.open = false;
  });
  function openHashTarget() {
    var hash = location.hash.slice(1);
    if (!hash) { if (windowPanel && windowPanel.open) closeModel(); return; }
    var modelName = Object.keys(categories).find(function (name) { return categories[name].id === hash; });
    if (hash === 'site-model') modelName = 'subdivision';
    if (modelName) {
      openModel(modelName, document.querySelector('.project-choices [data-model-open="' + modelName + '"]'));
    } else {
      if (windowPanel && windowPanel.open) closeModel();
      if (['offers','engineering'].indexOf(hash) !== -1) hash = 'project-models';
      var target = document.getElementById(hash);
      if (target) { reveal(target); requestAnimationFrame(function () { target.scrollIntoView({block:'start'}); }); }
    }
  }
  // Menus close when you tap elsewhere or press Escape.
  var menus = Array.from(document.querySelectorAll('details.mnav, details.bar-menu'));
  document.addEventListener('click', function (event) {
    menus.forEach(function (menu) { if (menu.open && !menu.contains(event.target)) menu.open = false; });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    menus.forEach(function (menu) { if (menu.open) { menu.open = false; menu.querySelector('summary').focus(); } });
  });
  // The desktop header stays in view and tightens up once the page is scrolled.
  var markScrolled = function () { document.documentElement.classList.toggle('scrolled', window.scrollY > 120); };
  window.addEventListener('scroll', markScrolled, {passive: true}); markScrolled();
  // Fetch the 3D files ahead of time so a model window opens without a wait: quietly when the browser is idle,
  // and straight away when a visitor reaches for one of the project buttons. Skipped on data-saver and very slow links.
  var link = navigator.connection || {};
  var frugal = !!link.saveData || /(^|-)2g$/.test(String(link.effectiveType || ''));
  function prefetchModels() {
    if (frugal) return;
    ['assets/three-r128.min.js', 'jce-models.js'].forEach(function (path) {
      var hint = document.createElement('link'); hint.rel = 'prefetch'; hint.as = 'script'; hint.href = path + '?v=20261006-18';
      document.head.appendChild(hint);
    });
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(prefetchModels, {timeout: 5000}); else setTimeout(prefetchModels, 3000);
  Array.from(document.querySelectorAll('.project-choices [data-model-open]')).forEach(function (choice) {
    ['pointerenter', 'touchstart', 'focus'].forEach(function (type) {
      choice.addEventListener(type, function () { if (!frugal) models(); }, {passive: true, once: true});
    });
  });
  // Plans to model: the project model runs in its own frame, loaded the first time the tab opens.
  var plansPanel = document.querySelector('[data-model-panel="digital"]');
  var plansFrame = plansPanel && plansPanel.querySelector('iframe');
  var plansStep = 'build', plansReady = false;
  function plansSend(message) { if (plansFrame && plansFrame.contentWindow && plansReady) plansFrame.contentWindow.postMessage(message, '*'); }
  function plansLoad() {
    if (!plansFrame || plansFrame.getAttribute('src')) return;
    plansFrame.setAttribute('src', window.__jceModelSrc ? window.__jceModelSrc() : plansFrame.getAttribute('data-src'));
    setTimeout(function () {
      if (plansReady || !plansFrame.parentNode || plansFrame.parentNode.querySelector('.frame-fallback')) return;
      var note = document.createElement('p'); note.className = 'frame-fallback';
      note.innerHTML = 'The 3D model is taking longer than expected to load. <a href="' + plansFrame.getAttribute('data-src').replace('&amp;', '&') + '" target="_blank" rel="noopener">Open it on its own page</a> or press Plan to see the drawing.';
      plansFrame.parentNode.appendChild(note);
      document.dispatchEvent(new CustomEvent('jce:model-ready', {detail: {name: 'digital'}}));
    }, 20000);
  }
  window.addEventListener('message', function (event) {
    if (!plansFrame || event.source !== plansFrame.contentWindow || !event.data || event.data.jceModelReady !== 'digital') return;
    plansReady = true; plansSend({jceStep: plansStep});
    var late = plansFrame.parentNode.querySelector('.frame-fallback'); if (late) late.remove();
    document.dispatchEvent(new CustomEvent('jce:model-ready', {detail: {name: 'digital'}}));
  });
  // On wide screens the project model fills the space between the tabs and the footer, with its buttons over the bottom edge.
  function sizePlansStage() {
    if (!plansPanel || plansPanel.hidden || !plansFrame) return;
    var stage = plansFrame.parentNode, visual = stage.parentNode, footer = document.querySelector('.model-window-footer');
    if (window.innerWidth < 900 || !footer) { stage.style.height = ''; visual.style.removeProperty('--stage-h'); return; }
    var body = document.querySelector('.model-window-body'), top = stage.getBoundingClientRect().top + (body ? body.scrollTop : 0) - (body ? body.getBoundingClientRect().top : 0);
    var avail = footer.getBoundingClientRect().top - (body ? body.getBoundingClientRect().top : 0) - top - 14;
    var h = Math.max(420, Math.min(820, Math.round(avail)));
    stage.style.height = h + 'px'; visual.style.setProperty('--stage-h', h + 'px');
  }
  window.addEventListener('resize', sizePlansStage);
  document.addEventListener('jce:model-ready', function (event) { if (event.detail.name === 'digital') requestAnimationFrame(sizePlansStage); });
  if (window.ResizeObserver && plansPanel) new ResizeObserver(function () { sizePlansStage(); }).observe(document.querySelector('.model-window-body') || plansPanel);
  document.addEventListener('jce:model-open', function (event) { if (event.detail.name === 'digital') requestAnimationFrame(sizePlansStage); });
  document.addEventListener('jce:model-open', function (event) { if (event.detail.name === 'digital') plansLoad(); });
  if (plansPanel) {
    Array.from(plansPanel.querySelectorAll('[data-plans-step]')).forEach(function (button) {
      button.addEventListener('click', function () {
        plansStep = button.getAttribute('data-plans-step');
        plansPanel.querySelectorAll('[data-plans-step]').forEach(function (b) { b.setAttribute('aria-pressed', b === button ? 'true' : 'false'); });
        plansPanel.querySelectorAll('.mv-text article').forEach(function (art) { art.hidden = art.getAttribute('data-for') !== plansStep; });
        var sheet = plansPanel.querySelector('.plan-sheet'); if (sheet) { sheet.hidden = plansStep !== 'plans'; if (!sheet.hidden && sheetPZ.get(sheet)) sheetPZ.get(sheet).reset(); }
        plansSend({jceStep: plansStep});
      });
    });
    var plansReset = plansPanel.querySelector('[data-plans-reset]');
    if (plansReset) plansReset.addEventListener('click', function () { plansSend({jceReset: true}); });
  }
  // Pan and zoom for plan sheets: drag to pan, pinch or wheel to zoom, double-tap to toggle.
  function panZoom(box) {
    var img = box.querySelector('img'); if (!img) return null;
    var s = 1, tx = 0, ty = 0, MAX = 8, pts = new Map(), last = null, pinch = null, lastTap = 0;
    function clamp() {
      var w = box.clientWidth, h = box.clientHeight;
      s = Math.max(1, Math.min(MAX, s));
      tx = Math.min(0, Math.max(w * (1 - s), tx)); ty = Math.min(0, Math.max(h * (1 - s), ty));
    }
    function draw() { clamp(); img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')'; box.classList.toggle('pz-zoomed', s > 1.01); }
    function zoomAt(f, cx, cy) { var ns = Math.max(1, Math.min(MAX, s * f)), k = ns / s; tx = cx - (cx - tx) * k; ty = cy - (cy - ty) * k; s = ns; draw(); }
    function local(e) { var r = box.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top}; }
    box.addEventListener('wheel', function (e) { e.preventDefault(); var p = local(e); zoomAt(Math.exp(-e.deltaY * 0.0018), p.x, p.y); }, {passive: false});
    box.addEventListener('pointerdown', function (e) {
      if (e.target.closest('a,button')) return;
      box.classList.add('pz-used');
      box.setPointerCapture(e.pointerId); pts.set(e.pointerId, local(e));
      if (pts.size === 1) {
        last = local(e); var now = Date.now();
        if (now - lastTap < 300) { var p = local(e); if (s > 1.01) { s = 1; tx = 0; ty = 0; draw(); } else zoomAt(3, p.x, p.y); lastTap = 0; } else lastTap = now;
      }
      if (pts.size === 2) { var a = Array.from(pts.values()); pinch = {d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), s: s}; }
    });
    box.addEventListener('pointermove', function (e) {
      if (!pts.has(e.pointerId)) return; var p = local(e); pts.set(e.pointerId, p);
      if (pts.size >= 2 && pinch) {
        var a = Array.from(pts.values()), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2;
        zoomAt((pinch.s * d / pinch.d) / s, mx, my);
      } else if (last && s > 1.01) { tx += p.x - last.x; ty += p.y - last.y; last = p; draw(); }
      else last = p;
    });
    function up(e) { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (pts.size === 1) last = Array.from(pts.values())[0]; if (!pts.size) last = null; }
    box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
    window.addEventListener('resize', draw);
    return {reset: function () { s = 1; tx = 0; ty = 0; draw(); }, zoomTo: function (f) { zoomAt(f / s, box.clientWidth / 2, box.clientHeight / 2); }, scale: function () { return s; }};
  }
  var sheetPZ = new Map();
  Array.from(document.querySelectorAll('[data-panzoom]')).forEach(function (box) { sheetPZ.set(box, panZoom(box)); });
  // Full plan sheet: opens over the model window, fitted to the screen, with a zoom toggle.
  var sheetViewer = document.getElementById('sheetViewer');
  if (sheetViewer && sheetViewer.showModal) {
    var sheetScroll = sheetViewer.querySelector('.sheet-viewer-scroll'), sheetZoom = sheetViewer.querySelector('[data-sheet-zoom]');
    var viewerPZ = sheetPZ.get(sheetScroll);
    function setSheetZoom(on) { if (viewerPZ) { if (on) viewerPZ.zoomTo(3); else viewerPZ.reset(); } sheetZoom.setAttribute('aria-pressed', on ? 'true' : 'false'); sheetZoom.textContent = on ? 'Fit to screen' : 'Zoom in'; }
    document.addEventListener('click', function (event) {
      var open = event.target.closest('[data-sheet-open]'); if (!open) return;
      event.preventDefault(); setSheetZoom(false); sheetViewer.showModal(); sheetScroll.scrollTop = 0; sheetScroll.scrollLeft = 0;
    });
    sheetZoom.addEventListener('click', function () {
      setSheetZoom(!(viewerPZ && viewerPZ.scale() > 1.01));
    });
    sheetViewer.querySelector('[data-sheet-close]').addEventListener('click', function () { sheetViewer.close(); });
    sheetViewer.addEventListener('click', function (event) { if (event.target === sheetViewer) sheetViewer.close(); });
  }
  window.addEventListener('hashchange', openHashTarget);
  if (location.hash) openHashTarget();
})();
