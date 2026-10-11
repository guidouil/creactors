import { defineConfig, type Plugin } from 'vite';

/** One deliberately narrow entrypoint; avoids a general-purpose glob dependency. */
function portableHtml(): Plugin {
  return {
    name: 'creactors-portable-html',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const entry = bundle['index.html'];
      if (!entry || entry.type !== 'asset') throw new Error('Missing HTML entrypoint.');
      let html = String(entry.source);
      const keyFor = (url: string) => url.replace(/^\.\//, '').replace(/^\//, '');
      html = html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (_tag, url: string) => {
        const key = keyFor(url);
        const script = bundle[key];
        if (!script || script.type !== 'chunk') throw new Error(`Unbundled script: ${url}`);
        delete bundle[key];
        return `<script type="module">${script.code.replace(/<\/script/gi, '<\\/script')}</script>`;
      });
      html = html.replace(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/g, (tag, url: string) => {
        if (!tag.includes('stylesheet')) return tag;
        const key = keyFor(url);
        const css = bundle[key];
        if (!css || css.type !== 'asset') throw new Error(`Unbundled stylesheet: ${url}`);
        delete bundle[key];
        return `<style>${String(css.source).replace(/<\/style/gi, '<\\/style')}</style>`;
      });
      entry.source = html;
      if (Object.keys(bundle).some(key => key !== 'index.html')) throw new Error('Portable build contains external assets.');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [portableHtml()],
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: Infinity,
    cssCodeSplit: false,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
