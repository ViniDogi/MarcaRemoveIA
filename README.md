# 🚀 MarcaRemoveIA

> **Plataforma Web Profissional para Remoção Inteligente de Marcas d'Água em Vídeos com IA, Aceleração por Hardware Universal (GPU/CPU) e Download por Link.**

[![Node.js Version](https://img.shields.io/badge/Node.js-20%2B%20%7C%2024%20ESM-green.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-0078D6.svg)](https://github.com/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-Hardware%20Accelerated-orange.svg)](https://ffmpeg.org/)
[![yt--dlp](https://img.shields.io/badge/yt--dlp-Integrated-red.svg)](https://github.com/yt-dlp/yt-dlp)
[![ONNX Runtime](https://img.shields.io/badge/ONNX%20Runtime-CUDA%20%7C%20DirectML%20%7C%20CPU-blue.svg)](https://onnxruntime.ai/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 🎯 Sobre o Projeto

O **MarcaRemoveIA** é um servidor web moderno (`http://127.0.0.1:8000`) desenvolvido integralmente em **JavaScript (Node.js ESM)** para identificar e remover marcas d'água, logotipos, carimbos e legendas em vídeos com alta precisão e performance otimizada.

O sistema opera sem dependências legadas em Python no runtime, chamando binários como **FFmpeg** e **yt-dlp** diretamente via `child_process.spawn` (com argumentos em array isolados, eliminando riscos de injeção de shell).

---

## ✨ Recursos Implementados

### 1. Correção Definitiva do Erro -22 no `h264_nvenc` e Dimensões Ímpares
- **Causa Raiz Corrigida:** Os encoders de GPU NVIDIA (NVENC) exigem obrigatoriamente que as dimensões de largura e altura sejam números pares e formatos de pixel compatíveis.
- **Filtro Universal:** Toda a cadeia de processamento aplica `scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`, além de `-pix_fmt yuv420p` e `-movflags +faststart`.
- **Cadeia de Fallback Automático:** Caso ocorra qualquer falha no encoder selecionado ou driver da GPU, o sistema tenta sequencialmente o próximo encoder funcional até o fallback universal em CPU (`libx264`), garantindo que o vídeo sempre seja concluído.
- **Modal de Erro em 2 Camadas:** Exibe mensagem amigável em português com botão expansor para inspecionar os logs técnicos brutos do FFmpeg gravados em `logs/ffmpeg-<taskId>.log`.

### 2. Detector Ativo de Aceleração por Hardware (`src/core/encoder-detector.js`)
- Não depende apenas da listagem estática do FFmpeg: realiza um **teste ativo de codificação real de 0.5s** na inicialização para validar o hardware.
- Suporte a:
  - **NVIDIA:** `h264_nvenc` (presets `p4`, `rc vbr`, `cq 23`)
  - **Intel:** `h264_qsv` (`global_quality 23`)
  - **AMD:** `h264_amf` (`quality balanced`)
  - **Apple Silicon:** `h264_videotoolbox` (`b:v 4M`)
  - **Linux:** `h264_vaapi`
  - **CPU Universal:** `libx264` (`preset veryfast`, `crf 23`)
- Seletor manual de hardware na interface web com indicação do hardware ativo e status em tempo real.

### 3. Remoção por Imagem da Marca (Template Matching)
- Permite o upload de uma imagem da marca d'água (PNG com canal alpha transparente ou JPG).
- **Extração de Máscara Alpha:** Aplica dilatação morfológica configurável nas bordas para absorver sombras e semitransparências.
- **Localização Multi-escala:** Realiza busca multi-escala (0.7x a 1.3x) ao longo dos frames amostrados do vídeo e calcula a caixa mediana.
- **Prévia de 1 Frame:** Permite gerar instantaneamente a prévia do quadro tratado antes de renderizar o vídeo inteiro.

### 4. Detecção e Remoção com IA (ONNX Runtime e Análise Temporal)
- Integração com **ONNX Runtime Node** (`onnxruntime-node`) priorizando:
  $$\text{CUDA} \longrightarrow \text{DirectML (Windows)} \longrightarrow \text{CoreML (macOS)} \longrightarrow \text{CPU}$$
- **Estabilidade Temporal de Marcas Estáticas:** Análise de variância temporal de pixels entre quadros espaçados, isolando marcas fixas em cantos e legendas.
- **Supressão Não-Máxima (NMS):** Consolidação automática de caixas de detecção redundantes.
- **Suavização Temporal:** Interpolação de trajetória e média móvel ponderada para evitar cintilação (*flicker*) em marcas dinâmicas.
- **Redimensionamento Interativo no Canvas:** Permite arrastar, reposicionar e redimensionar através de 4 alças nos cantos qualquer caixa sugerida ou desenhada.

### 5. Download de Vídeos por Link com yt-dlp
- Download rápido via URL compatível com centenas de plataformas (YouTube, TikTok, Instagram, Twitter/X, Vimeo, etc.).
- **Proteção Rigorosa contra SSRF:** Bloqueio de conexões para IPs privados (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8), redes link-local (169.254.0.0/16 - metadados de nuvem AWS/GCP/Azure), IPv6 loopback e resolução DNS interna.
- **Metadados e Seletor de Qualidade:** Consulta instantânea de título, thumbnail, duração e estimativas de tamanho em MB (1080p, 720p, 480p, 360p, Apenas Áudio).
- **Streaming de Progresso em Tempo Real:** Atualização de porcentagem, velocidade de download e ETA via Server-Sent Events (SSE).
- **Pipeline Baixar e Limpar:** Opção para baixar e processar diretamente em sequência contínua.
- **Atualizador Integrado:** Botão na interface para atualizar o executável do yt-dlp (`yt-dlp -U`).

---

## 📁 Estrutura de Arquivos

```text
MarcaRemoveIA/
├── package.json              # Configuração Node.js ESM, dependências e scripts
├── src/
│   ├── server.js             # Servidor Express com rotas de upload, download, SSE e IA
│   ├── core/
│   │   ├── encoder-detector.js # Detecção ativa e benchmark de encoders GPU/CPU
│   │   ├── processor.js      # Motor FFmpeg com pipeline delogo, áudio AAC e upscale
│   │   ├── template-matcher.js# Busca multi-escala por imagem e dilatação de máscara
│   │   ├── onnx-engine.js    # ONNX Runtime, estabilidade temporal e NMS
│   │   ├── ai-detector.js    # Conectores de IA Vision (Gemini / OpenAI) e frames
│   │   ├── downloader.js     # Integração yt-dlp com proteção anti-SSRF
│   │   └── models-manifest.json # Manifesto de modelos neurais com SHA-256
│   └── utils/
│       └── ffmpeg.js         # Utilitários FFmpeg/FFprobe e validações de mídia
├── index.html                # Interface moderna SPA (TailwindCSS, Canvas interativo e motor de gravação no navegador)
├── api/
│   └── index.js              # Handler Serverless Vercel
├── tests/
│   ├── parity.test.js        # Teste de paridade com vídeo sintético
│   ├── encoder.test.js       # Testes de detecção de hardware e fallback
│   ├── template-matcher.test.js # Testes de máscara alpha e template matching
│   ├── onnx-hybrid.test.js   # Testes de NMS, suavização e variância temporal
│   └── downloader.test.js    # Testes de bloqueio SSRF e integração yt-dlp
└── logs/                     # Registros técnicos do FFmpeg para depuração
```

---

## 🛠️ Requisitos e Instalação

### Pré-requisitos
1. **Node.js 20+ ou Node.js 24 (LTS/Current)**
2. **FFmpeg** instalado e acessível no PATH do sistema.
3. **yt-dlp** instalado e acessível no PATH do sistema.

#### Instalação rápida no Windows via winget:
```powershell
winget install Gyan.FFmpeg
winget install yt-dlp.yt-dlp
```

### Instalação das dependências do projeto
```bash
npm install
```

---

## 🚀 Como Executar

### 1. Iniciar o Servidor Web
```bash
npm start
```
Ou em modo de desenvolvimento com auto-reload:
```bash
npm run dev
```

Acesse no navegador:
👉 **`http://127.0.0.1:8000`**

### 2. Executar a Suíte de Testes Automatizados
```bash
npm test
```
Executa todos os testes automatizados da pasta `tests/` cobrindo paridade, encoders, detecção por imagem, ONNX/NMS e segurança SSRF.

---

## ⚖️ Aviso Legal e Uso Responsável

A funcionalidade de download de vídeos destina-se exclusivamente a conteúdos próprios, obras em domínio público ou materiais para os quais você possua autorização expressa do titular dos direitos. Respeite os direitos autorais e os termos de serviço dos provedores.

---

## 📄 Licença

Distribuído sob a licença **MIT**. Consulte o arquivo [`LICENSE`](LICENSE) para mais detalhes.
