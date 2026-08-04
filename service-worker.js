// Compatibility entrypoint untuk instalasi PWA legacy dari index.html.
// Seluruh strategi cache dan fetch dimiliki oleh sw.js.
// File ini dapat dihapus setelah registrasi legacy dipindahkan dari index.html.
importScripts('./sw.js');
