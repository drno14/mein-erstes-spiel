import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

const SETTINGS_FILE = resolve(import.meta.dirname, 'public/figur-settings.json');

/** Dev-Server-Endpunkt: der Bewegungs-Editor speichert hier seine Einstellungen dauerhaft. */
function figurSettingsPlugin() {
  return {
    name: 'figur-settings',
    configureServer(server) {
      server.middlewares.use('/api/figur-settings', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 100_000) req.destroy();   // Schutz vor riesigen Anfragen
        });
        req.on('end', async () => {
          try {
            const data = JSON.parse(body);
            if (!data || typeof data !== 'object' || typeof (data.profiles ?? data.values) !== 'object') throw new Error('Ungültiges Format');
            await writeFile(SETTINGS_FILE, JSON.stringify(data, null, 2) + '\n');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  // relative Pfade → läuft lokal und auf GitHub Pages (Unterordner /mein-erstes-spiel/)
  base: './',
  plugins: [figurSettingsPlugin()],
  build: {
    // WebGPU-Browser können top-level await usw. – kein Herunterkompilieren nötig
    target: 'esnext',
    rollupOptions: {
      input: {
        spiel: resolve(import.meta.dirname, 'index.html'),
        editor: resolve(import.meta.dirname, 'editor.html'),
      },
    },
  },
});
