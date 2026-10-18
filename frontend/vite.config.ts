import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// 后端地址：开发时默认对着 tools/mock-server（8787）；切真后端时设 BACKEND_URL
const backend = process.env.BACKEND_URL ?? 'http://localhost:8787'
// 麦克风 30 分钟测试时，把 /api/audio 转给本地的 tools/audio-sink.mjs（8788）
const audioSink = process.env.AUDIO_SINK

const proxy: Record<string, object> = {}
if (audioSink) proxy['/api/audio'] = { target: audioSink, changeOrigin: true }
proxy['/api'] = { target: backend, changeOrigin: true }
proxy['/debug'] = { target: backend, changeOrigin: true }
proxy['/ws'] = { target: backend.replace(/^http/, 'ws'), ws: true, changeOrigin: true }

// 临时隧道（只在真机测试时开，测完关掉）
const allowedHosts = ['.pinggy.net', '.pinggy-free.link']

export default defineConfig({
  plugins: [
    react(),
    // Silero VAD 运行时要的 worklet、模型和 onnxruntime 的 wasm，原样放到 /vad/
    viteStaticCopy({
      targets: [
        { src: 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js', dest: 'vad', rename: { stripBase: true } },
        { src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx', dest: 'vad', rename: { stripBase: true } },
        { src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', dest: 'vad', rename: { stripBase: true } },
        { src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', dest: 'vad', rename: { stripBase: true } },
      ],
    }),
  ],
  server: { host: true, port: 5173, allowedHosts, proxy },
  // 麦克风长测用打包版本跑在 4173，改代码时开发服务器的自动刷新不会打断它
  preview: { host: true, port: 4173, allowedHosts, proxy },
})
