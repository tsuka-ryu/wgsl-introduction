// The Book of Shaders — 09 パターン: デザイン要素を半円にする (番地回転 + アニメ)
// https://thebookofshaders.com/09/?lan=jp
//
// 09-rotate-tile-anim はマスの中身が三角形 (step(x,y)) だった。本のラスト課題
// 「三角形を他の要素 (半円・回転四角・線…) に変えてみよう」を半円でやる。
//
// 肝は "形を差し替えるだけ"。座標を作るチェーン (tile → 番地回転 → 回し戻し) は
// そのまま、最後に呼ぶ関数を step から halfCircle に変える。denotational には
//   image = halfCircle ∘ (座標変換チェーン)
// で、∘ の左側 (形) を入れ替えただけ。座標側のロジックは何も知らなくていい。
//
// 半円の作り方 (1 ピクセル p で):
//   セルの下辺中央 (0.5, 0.0) を中心にした半径 r の円を考える。中心がセルの縁に
//   乗っているので、円のうちセル内 (y>=0) に入るのは "上半分" = 半円。
//   d = distance(st, (0.5,0)) が r 未満なら内側。smoothstep で縁をぼかす。
//   番地回転で 4 向きに向くと、隣のセルの半円とつながって円・葉・スカラップになる。
//
// アニメは 09-rotate-tile-anim と同じ: 番地回転を逆向き回転で挟み (非可換でズレが
// 揺らぐ)、角度は sin で往復させてチラつかせない。

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
    label: "book of shaders 09 - tile half-circle (anim)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const PI = 3.14159265358979323846;

      // GLSL の mod(x,y)=x-y*floor(x/y) (常に [0,y) の正の余り)。番地の偶奇判定に使う。
      fn modf2(x: f32, y: f32) -> f32 {
        return x - y * floor(x / y);
      }

      // 中心 0.5 を軸にローカル座標を回転 (08-rotate と同じ)。
      fn rotate2D(stIn: vec2f, angle: f32) -> vec2f {
        let c = cos(angle);
        let s = sin(angle);
        let m = mat2x2f(c, -s, s, c);
        return m * (stIn - vec2f(0.5)) + vec2f(0.5);
      }

      // 拡大して fract で 0〜1 に畳むだけの素のタイル化。
      fn tile(stIn: vec2f, zoom: f32) -> vec2f {
        return fract(stIn * zoom);
      }

      // マスを 2x2 に割り、小マスの番地 (0..3) ごとに違う角度で回す。
      fn rotateTilePattern(stIn: vec2f) -> vec2f {
        var st = stIn * 2.0; // 1 マス → 2x2 の小マスへ

        var index = 0.0;
        index += step(1.0, modf2(st.x, 2.0));
        index += step(1.0, modf2(st.y, 2.0)) * 2.0;

        st = fract(st);

        if (index == 1.0) {
          st = rotate2D(st, PI * 0.5);
        } else if (index == 2.0) {
          st = rotate2D(st, PI * -0.5);
        } else if (index == 3.0) {
          st = rotate2D(st, PI);
        }
        return st;
      }

      // 半円: 下辺中央 (0.5,0) を中心にした半径 r の円のうち、セル内に入る上半分。
      // 返り値 1=内側。smoothstep で縁を 1px ぶんぼかしてジャギを消す。
      fn halfCircle(st: vec2f, r: f32) -> f32 {
        let d = distance(st, vec2f(0.5, 0.0));
        return smoothstep(r, r - 0.01, d);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution; // 0〜1 の画面座標
        st.y = 1.0 - st.y;                   // GL と同じく y を上向きに

        // 角度は sin で行って戻る揺れに (単調回転のチラつきを避ける)。
        let a = sin(u.time * 0.5) * PI * 0.5;

        st = tile(st, 3.0);          // 3x3 に畳む (細分化は 1 層)
        st = rotate2D(st, -a);       // 層を時間で回す
        st = rotateTilePattern(st);  // 番地回転 (回転と非可換)
        st = rotate2D(st, a);        // 回し戻す → ③とズレて揺らぐ

        // 形を step(三角形) → halfCircle(半円) に差し替えただけ。
        let color = vec3f(halfCircle(st, 0.5));

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "tile half-circle anim pipeline",
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
