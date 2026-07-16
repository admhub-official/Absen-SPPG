window.ABSEN_SUPABASE_CONFIG = window.ABSEN_SUPABASE_CONFIG || {
  projectUrl: 'https://szwwpnbbsmjsbzzcecyj.supabase.co',
  functionUrl: 'https://szwwpnbbsmjsbzzcecyj.supabase.co/functions/v1/Absen',
  functionName: 'Absen',
  apiKey: ''
};

(function () {
  function load(src) {
    var script = document.createElement('script');
    script.src = src;
    script.defer = true;
    document.head.appendChild(script);
  }
  load('./features.js?v=20260716');
  load('./feature-menu-hotfix.js?v=20260716-2');
})();