// The Book of Shaders — 09 パターン: 動くトルシェタイル (円弧 + 上下左右スライド)
// https://thebookofshaders.com/09/?lan=jp
//
// 09-moving-tiles は「円が上下左右にスライドする」動きだった。あの動き (movingTiles)
// はそのままに、中身の円を トルシェタイル の円弧に差し替える。
//
// トルシェタイルとは: 1 マスに「対角の隅を結ぶ 1/4 円弧 2 本」を描いたタイル。隣の
// マスと辺の中点で円弧の端が必ず合うので、向きを変えながら敷き詰めると線が途切れず
// つながり、迷路や輪の模様になる。ここでは向きをチェッカー状 (番地の偶奇) に反転させ、
// 同心円が並ぶ古典的なトルシェ模様にする。
//
// 構造 (denotational):
//   image = truchet ∘ (movingTiles で時間スライドした座標)
//   - movingTiles: st を zoom 倍し、フェーズで縦/横に、列(段)の偶奇で逆向きに滑らせる
//                  (09-moving-tiles と同じ。ただし最後の fract はやめ、整数部=番地を残す)
//   - 番地 ipos の偶奇で fpos.x を鏡映 → 円弧の向きを 2 種類に振る (トルシェの肝)
//   - truchet: マス内ローカル座標 fpos に 1/4 円弧 2 本を描く
//
// なぜスライドで "ずれて再びつながる" か (1 ピクセル p で):
//   縦フェーズでは列ごとに上下逆向きに滑る。滑り量 amt は 0→2 (タイル 2 個ぶん) で、
//   整数のときだけ辺の中点が隣と一致して円弧がつながる。途中は端点がずれて模様が
//   ぱきっとせん断され、また整数で輪に戻る。この "ほどけ↔つながり" が見どころ。

import { fail } from "../../webgpu-fundamentals/util";

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    fail("このブラウザは WebGPU に対応していません (Chrome / Edge 113+ など)。");
    return;
  }

  const canvas = document.querySelector("canvas")!;
  const context = canvas.getContext("webgpu")!;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: presentationFormat });

  const module = device.createShaderModule({
    label: "book of shaders 09 - moving truchet tiles",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // GLSL の mod(x,y)=x-y*floor(x/y) (常に [0,y) の正の余り)。番地の偶奇判定に使う。
      fn modf2(x: f32, y: f32) -> f32 {
        return x - y * floor(x / y);
      }

      // 09-moving-tiles と同じスライド。ただし最後に fract せず "ずらした座標" を返す
      // (呼び側で floor して番地、fract でマス内ローカルを取り分けたいため)。
      fn movingTiles(stIn: vec2f, zoom: f32, speed: f32) -> vec2f {
        var st = stIn * zoom;
        let time = u.time * speed;
        let amt = fract(time) * 2.0; // 各フェーズのずらし量 (0→2 タイル)

        if (fract(time) > 0.5) {
          // 横フェーズ: 段の偶奇で x を逆向きに
          if (fract(st.y * 0.5) > 0.5) { st.x += amt; } else { st.x -= amt; }
        } else {
          // 縦フェーズ: 列の偶奇で y を逆向きに
          if (fract(st.x * 0.5) > 0.5) { st.y += amt; } else { st.y -= amt; }
        }
        return st;
      }

      // トルシェタイル: マス内ローカル fpos に対角の隅を結ぶ 1/4 円弧 2 本を描く。
      // 隅 (0,0) と (1,1) を中心にした半径 0.5 の円の "線" (= 半径からの距離が小さい所)。
      // 2 本の近い方を採り、太さ w で 2 値化。返り値 1=線上。
      fn truchet(fpos: vec2f, w: f32) -> f32 {
        let d = min(abs(distance(fpos, vec2f(0.0, 0.0)) - 0.5),
                    abs(distance(fpos, vec2f(1.0, 1.0)) - 0.5));
        return 1.0 - smoothstep(w, w + 0.02, d); // 縁を 0.02 ぶんぼかす
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution; // 0〜1 の画面座標
        st.y = 1.0 - st.y;                   // GL と同じく y を上向きに
        st.x *= u.resolution.x / u.resolution.y; // アスペクト補正 (マスを正方形に)

        let g = movingTiles(st, 5.0, 0.5); // スライドした座標 (整数部=番地 / 小数部=マス内)
        let ipos = floor(g);
        var fpos = fract(g);

        // 番地の偶奇で円弧の向きを反転 (鏡映) → トルシェのチェッカー配置。
        if (modf2(ipos.x + ipos.y, 2.0) > 0.5) {
          fpos = vec2f(1.0 - fpos.x, fpos.y);
        }

        let color = vec3f(truchet(fpos, 0.12));

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "moving truchet pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  const uniformBufferSize = 4 * 4; // 16 バイト
  const uniformValues = new Float32Array(uniformBufferSize / 4);
  const kResolutionOffset = 0;
  const kTimeOffset = 2;

  const uniformBuffer = device.createBuffer({
    label: "uniforms (resolution, time)",
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  function render(device: GPUDevice, time: number) {
    uniformValues.set([canvas.width, canvas.height], kResolutionOffset);
    uniformValues[kTimeOffset] = time;
    device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: "canvas renderPass",
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: [0, 0, 0, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    };
    const encoder = device.createCommandEncoder({ label: "encoder" });
    const pass = encoder.beginRenderPass(renderPassDescriptor);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const c = entry.target as HTMLCanvasElement;
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;
      c.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
      c.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
    }
  });
  observer.observe(canvas);

  const frame = (timeMs: number) => {
    render(device, timeMs * 0.001);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();