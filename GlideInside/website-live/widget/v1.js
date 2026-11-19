/* Glide Inside "See it on your block" widget loader, version 1.
 * Add to a builder's website:
 *   <script src="https://glideinside.com.au/widget/v1.js" data-builder="your-builder-id" data-height="720" async></script>
 * It puts a frame of Glide Inside where the script tag is (or inside the element named by data-target, for example data-target="#see-it").
 * Visitors enter an address and pick one of the builder's designs. Concept only and indicative. No cookies are set by this file and it collects nothing. */
(function () {
  var s = document.currentScript;
  if (!s) { var all = document.getElementsByTagName('script'); for (var i = all.length - 1; i >= 0; i--) { if (/\/widget\/v1\.js/.test(all[i].src)) { s = all[i]; break; } } }
  if (!s) return;
  var id = (s.getAttribute('data-builder') || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9_:.-]{0,119}$/.test(id)) { if (window.console) console.warn('Glide Inside widget: add data-builder="your builder id" to the script tag.'); return; }
  var origin = s.src.replace(/\/widget\/v1\.js.*$/, '');
  var h = parseInt(s.getAttribute('data-height'), 10);
  if (!h || h < 420) h = 720;
  var f = document.createElement('iframe');
  f.src = origin + '/plan-studio/app/?embed=1&widget=' + encodeURIComponent(id) + '&host=' + encodeURIComponent(location.origin);
  f.title = 'See it on your block';
  f.loading = 'lazy';
  f.setAttribute('allow', 'fullscreen');
  f.style.cssText = 'border:0;width:100%;max-width:100%;height:' + h + 'px;display:block';
  var t = s.getAttribute('data-target');
  var host = t ? document.querySelector(t) : null;
  if (host) host.appendChild(f); else s.parentNode.insertBefore(f, s.nextSibling);
})();
