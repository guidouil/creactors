import { Box3, Box3Helper, BufferGeometry, Color, LineBasicMaterial, LineSegments, Vector3, type Group } from 'three';
import { evaluateScene } from '../scene/evaluator';
import type { SceneSpec } from '../scene/types';
import type { SceneRenderer } from '../scene/renderer';
import type { InputLanguage, TextAnalysis } from '../text/director';

interface InspectorAPI {
  ready: Promise<void>;
  readonly spec: SceneSpec;
  readonly analysis: TextAnalysis | null;
  readonly renderer: SceneRenderer;
  generate(text: string, seed: number, language?: InputLanguage): Promise<SceneSpec>;
  seek(time: number): void;
  state(): unknown;
  bounds(): unknown;
  metrics(): { frameTime: number; calls: number; triangles: number };
  capture(time: number): Promise<string>;
}

export async function mountInspector(api: InspectorAPI): Promise<void> {
  await api.ready;
  const panel = document.createElement('aside');
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:10;width:310px;max-height:65vh;overflow:auto;padding:18px;background:#17172c;border:1px solid #49435b;color:#ede8fa;font:11px/1.6 monospace;border-radius:8px;box-shadow:0 8px 40px #0008';
  panel.innerHTML = `<strong>CREACTORS / INSPECT</strong><p data-summary></p><label>SEED <input data-seed type="number" min="0" max="4294967295" style="width:130px"><button data-generate type="button">APPLY</button></label><input data-time aria-label="Scrub film" type="range" min="0" step="${1 / api.spec.fps}" value="0" style="width:100%;margin-top:12px"><div style="display:flex;gap:8px;margin:12px 0"><button type="button" data-path>PATH</button><button type="button" data-bounds>BOUNDS</button><button type="button" data-capture>CAPTURE</button></div><output></output><details><summary>ANALYSIS / GROUPS</summary><pre data-analysis></pre></details><details open><summary>SCENE GRAPH / SHOTS</summary><pre data-scene></pre></details>`;
  panel.querySelectorAll('pre').forEach(element => (element as HTMLElement).style.cssText = 'white-space:pre-wrap;font-size:10px');
  document.body.append(panel);
  const slider = panel.querySelector<HTMLInputElement>('[data-time]')!;
  const seed = panel.querySelector<HTMLInputElement>('[data-seed]')!;
  const output = panel.querySelector('output')!;
  const tree = panel.querySelector('[data-scene]')!;
  const analysis = panel.querySelector('[data-analysis]')!;
  const helpers: { root: Group; helper: Box3Helper }[] = [];
  let path: LineSegments | null = null;
  function clearHelpers() {
    for (const { helper } of helpers.splice(0)) { api.renderer.world.remove(helper); helper.dispose(); }
    if (path) { api.renderer.world.remove(path); path.geometry.dispose(); (path.material as LineBasicMaterial).dispose(); path = null; }
  }
  function refresh() {
    clearHelpers();
    slider.max = String(api.spec.duration);
    slider.value = '0';
    seed.value = String(api.spec.seed);
    const style = api.spec.directionStyle;
    panel.querySelector('[data-summary]')!.textContent = `${api.spec.generatorVersion} · ${api.spec.duration}s${style ? `\n${style.layout} / ${style.entry} / ${style.transition} / ${style.reveal} / ${style.finale}` : ''}`;
    tree.textContent = api.spec.objects.map(object => `${object.id} / ${object.extruded ? 'mesh' : 'SDF'}\n${object.text}\nposition ${object.position.map(x => x.toFixed(2)).join(', ')}\nread ${object.readingInterval.join('–')}s${object.impact ? `\nimpact ${object.impact.start.toFixed(2)}–${object.impact.end.toFixed(2)}s` : ''}${object.exit?.rotation ? `\nexit rotation ${object.exit.rotation.map(x => x.toFixed(2)).join(', ')}` : ''}`).join('\n\n') + '\n\n' + api.spec.cameraTracks.map(track => `${track.start.toFixed(2)}–${track.end.toFixed(2)} ${track.primitive}${track.cutBefore ? ' / CUT' : ''}${track.rollTurns ? ` / ROLL ${track.rollTurns}` : ''}${track.impact ? ' / IMPACT' : ''}`).join('\n');
    if (api.spec.finalImages?.length) tree.textContent += '\n\n' + api.spec.finalImages.map(image => `${image.id} / image\n${image.asset.name}\n${image.asset.width} × ${image.asset.height}\nvisible ${image.visibleInterval.map(time => time.toFixed(2)).join('–')}s\narrival ${image.entrance.start.toFixed(2)}–${image.entrance.end.toFixed(2)}s / exit ${image.exit.start.toFixed(2)}–${image.exit.end.toFixed(2)}s`).join('\n\n');
    analysis.textContent = api.analysis ? `language ${api.analysis.language} / confidence ${api.analysis.languageConfidence.toFixed(2)}\n${api.analysis.uncertainLanguage ? 'UNCERTAIN\n' : ''}${api.analysis.groups.map(group => `${JSON.stringify(group.text)}\nsource [${group.start}, ${group.end})\n${Object.entries(group.scores).map(([key, value]) => `${key} ${value.toFixed(2)}`).join(' / ')}\n${[group.negation && 'negation', group.conclusion && 'conclusion', group.contrast && 'contrast', group.repeated && 'repeated'].filter(Boolean).join(', ')}`).join('\n\n')}` : 'Authored reference film';
  }
  const update = () => {
    const time = Number(slider.value);
    api.seek(time);
    for (const { root, helper } of helpers) helper.box.setFromObject(root);
    if (helpers.length) api.renderer.renderFrame(time);
    const metrics = api.metrics();
    output.textContent = `${time.toFixed(2)}s · ${metrics.frameTime.toFixed(1)}ms · ${metrics.calls} draws · ${metrics.triangles.toLocaleString()} triangles`;
  };
  slider.addEventListener('input', update);
  window.addEventListener('creactors:scene', refresh);
  panel.querySelector('[data-generate]')!.addEventListener('click', async () => {
    await api.generate(api.spec.sourceText, Number(seed.value) >>> 0, api.analysis?.requestedLanguage);
    refresh(); update();
  });
  panel.querySelector('[data-path]')!.addEventListener('click', () => {
    if (path) {
      api.renderer.world.remove(path); path.geometry.dispose(); (path.material as LineBasicMaterial).dispose(); path = null;
    } else {
      const vertices: Vector3[] = [];
      const cuts = api.spec.cameraTracks.filter(track => track.cutBefore).map(track => track.start);
      const frameCount = Math.ceil(api.spec.duration * api.spec.fps);
      for (let frame = 1; frame <= frameCount; frame++) {
        const from = (frame - 1) / api.spec.fps, to = Math.min(frame / api.spec.fps, api.spec.duration);
        if (cuts.some(cut => cut > from && cut <= to)) continue;
        vertices.push(new Vector3(...evaluateScene(api.spec, from).camera.position), new Vector3(...evaluateScene(api.spec, to).camera.position));
      }
      path = new LineSegments(new BufferGeometry().setFromPoints(vertices), new LineBasicMaterial({ color: '#77D7F5' }));
      api.renderer.world.add(path);
    }
    update();
  });
  panel.querySelector('[data-bounds]')!.addEventListener('click', () => {
    if (helpers.length) for (const { helper } of helpers.splice(0)) { api.renderer.world.remove(helper); helper.dispose(); }
    else for (const root of api.renderer.objectRoots) {
      const helper = new Box3Helper(new Box3().setFromObject(root), new Color('#F58BB4'));
      helpers.push({ root, helper }); api.renderer.world.add(helper);
    }
    update();
  });
  panel.querySelector('[data-capture]')!.addEventListener('click', async () => {
    const anchor = document.createElement('a');
    anchor.href = await api.capture(Number(slider.value));
    anchor.download = `creactors-${api.spec.seed}-${Number(slider.value).toFixed(2)}s.png`;
    anchor.click();
  });
  refresh(); update();
}
