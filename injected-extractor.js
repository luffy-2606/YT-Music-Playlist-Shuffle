(function () {
    var MSG  = '__YTMS_DOM_TRACKS_V2__';
    var PH   = 'to_be_updated_by_client';
    var seen = new Set();
    var out  = [];
  
    var els = Array.from(
      document.querySelectorAll('ytmusic-responsive-list-item-renderer')
    );
  
    els.forEach(function (el, domIndex) {
      try {
        var d = el.data;
        if (!d) return;
  
        /* Priority 1: playlistItemData */
        var pid    = d.playlistItemData || {};
        var vid    = pid.videoId || '';
        var svid   = pid.playlistSetVideoId || '';
        if (svid === PH) svid = '';
  
        /* Priority 2: overlay watchEndpoint */
        if (!svid) {
          try {
            var we = d.overlay
              .musicItemThumbnailOverlayRenderer
              .content
              .musicPlayButtonRenderer
              .playNavigationEndpoint
              .watchEndpoint;
            if (!vid && we.videoId) vid = we.videoId;
            if (we.playlistSetVideoId && we.playlistSetVideoId !== PH) {
              svid = we.playlistSetVideoId;
            }
          } catch (_) {}
        }
  
        /* Priority 3: menu edit-endpoint actions */
        if (!svid) {
          try {
            var menuItems = d.menu.menuRenderer.items || [];
            outer:
            for (var mi = 0; mi < menuItems.length; mi++) {
              var svc = menuItems[mi].menuServiceItemRenderer;
              if (!svc) continue;
              var acts = (svc.serviceEndpoint &&
                          svc.serviceEndpoint.playlistEditEndpoint &&
                          svc.serviceEndpoint.playlistEditEndpoint.actions) || [];
              for (var ai = 0; ai < acts.length; ai++) {
                var sv = acts[ai].setVideoId;
                if (sv && sv !== PH) { svid = sv; break outer; }
              }
            }
          } catch (_) {}
        }
  
        /* Reject unresolvable tracks */
        if (!vid || !svid || svid === PH) return;
  
        /* Deduplicate by setVideoId */
        if (seen.has(svid)) return;
        seen.add(svid);
  
        /* Extract title / artist from flexColumns */
        var colText = function (n) {
          try {
            return (d.flexColumns[n]
              .musicResponsiveListItemFlexColumnRenderer
              .text.runs || [])
              .map(function (r) { return r.text; })
              .join('');
          } catch (_) { return ''; }
        };
  
        out.push({
          videoId  : vid,
          setVideoId: svid,
          title    : colText(0) || 'Unknown Title',
          artist   : colText(1) || 'Unknown Artist',
          duration : colText(d.flexColumns ? d.flexColumns.length - 1 : 2) || '',
          index    : out.length
        });
  
      } catch (_) { /* malformed renderer — skip silently */ }
    });
  
    window.postMessage({ type: MSG, tracks: out }, '*');
  })();