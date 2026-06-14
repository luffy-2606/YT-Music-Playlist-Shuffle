(() => {
    try {
      const d = window.ytcfg?.data_ || {};
      window.postMessage({
        type: '__YTMS_YTCFG__',
        payload: {
          INNERTUBE_API_KEY: d.INNERTUBE_API_KEY,
          INNERTUBE_CLIENT_VERSION: d.INNERTUBE_CLIENT_VERSION,
          VISITOR_DATA: d.VISITOR_DATA,
        }
      }, '*');
    } catch (e) {}
  })();