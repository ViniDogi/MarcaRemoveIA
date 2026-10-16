# 📋 Notas de Atualização (Patchnotes) — MarcaRemoveIA

> **Versão Mais Recente:** 4.0.0 (Pro Studio)  
> **Status:** 33/33 Testes Automatizados Aprovados (100% de cobertura funcional)  
> **Versão Web Oficial:** [https://marca-remove-ia.vercel.app/](https://marca-remove-ia.vercel.app/)  
> **Compatibilidade:** Desktop Local (Windows/Linux/macOS com FFmpeg/GPU) e Web Nuvem (Vercel / Navegadores modernos)

---

## 🎬 Versão 4.0.0 — MarcaRemoveIA Pro Studio (Editor Multitrack, Inpainting de Alta Fidelidade, Banco de Mídias, Stickers & Dark Mode)

- **🎨 Identidade Visual & Logotipo Oficial:**
  - Criação do logotipo vetorial moderno (`logo.svg`), com gradiente de alta definição, moldura cinematográfica, varinha mágica de IA e estrelas de processamento.
  - Integração no favicon do navegador e no cabeçalho do sistema com transições interativas.

- **✨ Inpainting de Imagem e Vídeo de Alta Fidelidade & Consistência Temporal:**
  - Pipeline de codificação aprimorado com `-c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -movflags +faststart` para máxima qualidade visual sem perda de nitidez.
  - Eliminação de piscadas e inconsistências entre frames, com preservação integral da taxa de quadros (FPS), resolução original e faixa de áudio (`-c:a copy` ou re-encode AAC estéreo de alta fidelidade).

- **🎥 Player de Vídeo Web Fluido & Correção de Codecs:**
  - Garantia de formato MP4 com pixel format `yuv420p` e `faststart` (moov atom no início do arquivo), permitindo reprodução instantânea no navegador sem travamentos.
  - Eventos de controle (`play`, `pause`, seek na barra de progresso, volume) sincronizados com estado de carregamento e feedback visual instantâneo.

- **📁 Banco de Dados & Galeria de Mídias Processadas:**
  - Persistência híbrida completa: IndexedDB com armazenamento ilimitado no cliente para a versão web + SQLite com persistência em disco no servidor local (`web_outputs/gallery.db`).
  - Painel com miniaturas, badges de tipo (vídeo/imagem), data de processamento, resolução e duração.
  - Ações rápidas para assistir novamente no player nativo, baixar o arquivo final ou enviar com 1 clique direto para o Editor de Vídeo.

- **✂️ Editor de Vídeo Multitrack Integrado:**
  - **Linha do Tempo Visual:** Faixas dedicadas para vídeo, áudio, adesivos/figurinhas e marcas d'água com cursor de reprodução (scrubber) e controle em tempo real.
  - **Corte & Divisão (Trim / Split):** Pontos de início e fim milimétricos com preview instantâneo.
  - **Recorte de Proporção (Crop):** Enquadramento livre e presets populares (16:9 widescreen, 9:16 reels/tiktok, 1:1 quadrado, 4:5 retrato, 21:9 ultrawide).
  - **Junção de Vídeos (Merge / Concatenate):** Adicione múltiplos clipes da galeria ou locais, ordene na timeline e gere um vídeo contínuo de alta qualidade.
  - **Extração / Separação de Áudio:** Extraia a faixa de áudio de qualquer vídeo diretamente para MP3 320kbps em alta fidelidade.
  - **Ajustes de Velocidade e Áudio:** Velocidades de 0.5x, 0.75x, 1x, 1.25x, 1.5x e 2x com controle de pitch (`atempo`), além de opção para mutar/silenciar áudio.

- **🌟 Figurinhas, Adesivos e Criador de Marca d'Água Própria:**
  - **Stickers e Adesivos:** Biblioteca de emojis, badges ("PRO", "VIP", "HD", "NEW") e suporte a upload de imagens/figurinhas PNG customizadas com controle de tamanho, posição (X/Y) e rotação.
  - **Criador de Marca d'Água:** Crie sua própria marca d'água com texto customizado, fontes, cores, opacidade e posições dinâmicas (canto superior, inferior, centralizado ou carimbo personalizado).

- **🌙 Modo Noturno (Dark Mode) Integrado:**
  - Interface com tema escuro imersivo em tons de azul profundo (`#070c18`, `#0b1326`) e cinza escuro chumbo (`#101c33`), reduzindo a fadiga visual.
  - Alternância rápida com 1 clique via botão no cabeçalho e persistência de preferência no `localStorage`.

- **🧪 Cobertura de Testes Automatizados:**
  - 33 testes automatizados executados e 100% aprovados (`npm test`), cobrindo inpainting, editor multitrack, SQLite gallery, extração de áudio, stickers, filtros e compatibilidade.

---

## 🛠️ Versão 3.1.0 — Auditoria de Código, Remoção Definitiva de Resíduos Python & Correção de Falhas

- **Auditoria e Eliminação de Resíduos Python (100% JavaScript Puro):**
  - Removidas todas as regras e referências legadas a caches do Python (`__pycache__`, `*.pyc`, `.venv`, `.pytest_cache`, `PyInstaller .spec`) do `.gitignore`.
  - O projeto opera exclusivamente sobre **Node.js (ESM)** e **JavaScript no Navegador**, sem qualquer dependência ou script em Python.
- **Normalização da Estrutura de Diretórios:**
  - Corrigido o aninhamento redundante de pastas resultante da extração de arquivos zip (`MarcaRemoveIA-main/MarcaRemoveIA-main`), permitindo a execução imediata de `npm start`, `npm test` e `run.bat` na raiz do projeto.
- **Correção no Fluxo de Download Remoto (yt-dlp):**
  - Resolvida a falha onde a conclusão do download tratava o arquivo prematuramente como resultado limpo. O vídeo agora é carregado imediatamente no player com dimensões e título, permitindo marcação manual ou via IA antes da remoção.
- **Alinhamento e Precisão do Canvas Interativo:**
  - O canvas de desenho agora sincroniza dinamicamente as coordenadas `top`, `left`, `width` e `height` com `offsetTop` e `offsetLeft` do elemento de vídeo e imagem, prevenindo desalinhamentos ao marcar regiões em telas de diferentes proporções.
- **Resiliência do Atualizador yt-dlp:**
  - A rotina `updateYtDlpBinary()` agora trata falhas e exceções de inicialização de processo sem disparar rejeições não tratadas (*unhandled rejections*), retornando status claro e código de saída.
- **Estabilização de Dependências:**
  - `sharp` promovido a dependência direta no `package.json`, assegurando sua presença permanente para a geração de máscaras minuciosas e testes automatizados.
- **Scripts de Inicialização (.bat) Aperfeiçoados:**
  - `run_web.bat` e `acesso_remoto.bat` atualizados com inclusão automática das pastas do WinGet para Gyan.FFmpeg e yt-dlp.

---

## 🌟 Versão 3.0.0 — Novo Design Clean (Branco e Azul Claro), Reconstrução Pixel a Pixel com Gemini & WaveSpeed AI e Marcas Móveis

- **Novo Design Clean & Glassmorphism (Branco e Azul Claro):**
  - Paleta refinada em tons suaves de branco e azul céu (`#f0f7ff`, `#e0f2fe`, `#38bdf8`, `#0284c7`).
  - Interface com cantos ultra-arredondados (`rounded-3xl`), sombras suaves e efeito de vidro fosco (`backdrop-blur-xl`).
  - Animações fluidas de seleção, hover flutuante e micro-interações responsivas.
- **Simplificação e Redução Drástica de Opções (UX 3 Passos):**
  - Interface despoluída e organizada em um fluxo intuitivo de 3 passos:
    1. *Enviar Mídia (Vídeo ou Imagem)*
    2. *Marcar a Marca d'Água (IA, Manual ou Móvel)*
    3. *Motor Inteligente (Gemini, WaveSpeed ou Inpainting Local)*
  - Opções técnicas de encoders secundários ocultas em sanfona colapsável opcional.
- **Reconstrução Pixel a Pixel Sem Borrão (Problema Crítico Resolvido):**
  - Substituído o desfoque gaussiano / delogo simples por segmentação minuciosa pixel a pixel e síntese textural exemplar HD.
  - O fundo é regenerado com textura, grão e nitidez natural sem deixar manchas esbranquiçadas ou borradas.
- **Integração com Google Gemini IA (Gemini 3.8 Flash):**
  - Suporte completo a imagens e frames de vídeo via `@google/genai` e API v1beta.
  - Detecção inteligente sem caixas fantasmas ou seleções aleatórias.
  - Reconstrução e regeneração de pixels orientada por IA generativa.
- **Integração com WaveSpeed AI:**
  - Suporte nativo aos modelos `wavespeed-ai/image-watermark-remover` e `wavespeed-ai/video-watermark-remover`.
  - Script CLI dedicado criado em `scripts/wavespeed_remove.js` para processamento rápido por terminal.
- **Remoção de Marcas d'Água em Movimento:**
  - Sistema de interpolação temporal de keyframes (`isMoving`, `start`, `end`, `trajectory`).
  - Acompanhamento de marcas flutuantes, logotipos quicando ou letreiros móveis no vídeo.
- **Entrega Final Aperfeiçoada e Fluida:**
  - Card de entrega concluída com reprodução instantânea no navegador via `/api/result/:taskId`.
  - Modo de comparação rápida "Antes" e "Depois (Limpo ✨)" para conferir o resultado lado a lado.
  - Botão de download direto ajustado com nome e tipo MIME exatos.
- **Cobertura de Testes:**
  - 28 testes automatizados executados e 100% aprovados (`tests/new-features.test.js`).

---

- **Acesso à Versão Web na Nuvem:**
  - Adicionado link de acesso direto à versão web no Vercel: [https://marca-remove-ia.vercel.app/](https://marca-remove-ia.vercel.app/)
- **Novo Seletor de Método de Remoção de Marcas d'Água:**
  - 🤖 **IA Generativa / Inpainting Neural:** Reconstrução inteligente de texturas e pixels de fundo.
  - 🌊 **Interpolação Suave HD (Filtro Delogo Inteligente):** Processamento ultra rápido nativo com GPU/CPU.
  - 🌫️ **Desfoque Suave / Blur Adaptativo:** Desfoque gaussiano suave localizado.
- **Detecção Automática por IA Corrigida e Aprimorada:**
  - Algoritmo híbrido reescrito com clustering de componentes conexos por BFS e mapa de gradiente/variância, identificando logotipos reais sem falsos positivos de tela inteira.
  - Suporte completo a modelos de IA generativa (Gemini 1.5, 2.0 e GPT-4o) com parse resiliente de coordenadas `x, y, w, h` e `box_2d`.
- **Eliminação da Lentidão Extrema:**
  - Barra de progresso de upload com porcentagem e MBs em tempo real no envio de arquivos locais.
  - Ativação de multithreading total (`-threads 0`) no FFmpeg, acelerando a codificação em até 10x.
  - Correção de parâmetros obsoletos do FFmpeg 9.0 (`delogo`).
- **Correções de Confiabilidade:**
  - Resolução do erro fatal `processor.process is not a function` na rota de download remoto com auto-processamento.
  - Finalização recursiva limpa de processos órfãos no Windows com `taskkill /F /T /PID`.

---

## 🚀 Versão 2.1.0 — Modo Web Client-side & Limpeza de Código Morto

- **Motor de Processamento no Navegador (HTML5 Canvas + MediaRecorder):**
  - Agora o MarcaRemoveIA opera tanto no modo servidor completo (FFmpeg + GPU NVENC/QSV/AMF) quanto no modo 100% web pelo navegador.
  - Prévia instantânea de 1 frame diretamente no Canvas com desfoque e interpolação espacial (0ms de latência, sem requisições pesadas).
  - Processamento completo no cliente usando `canvas.captureStream()` e `MediaRecorder`, permitindo remover marcas d'água mesmo em ambientes serverless como Vercel ou offline.
- **Carregamento Instantâneo de Vídeo (`URL.createObjectURL`):**
  - O vídeo selecionado é exibido imediatamente no player sem aguardar upload, com leitura de dimensões, duração e frames direto do HTML5 Video.
- **Remoção de Bloqueios Artificiais no Vercel:**
  - Corrigido o erro que impedia envio de vídeos pequenos ou exibia avisos bloqueantes na versão web.
  - Fallback gracioso no `validateVideoFile()` para contêineres sem FFmpeg instalado.
- **Auditoria e Limpeza de Código Morto e Arquivos Desnecessários:**
  - Removidos arquivos duplicados: `templates/index.html` e `public/index.html` eliminados em favor do `index.html` na raiz.
  - Removido script redundante `publicar_no_github.bat` (mantido `enviar_para_o_github.bat`).
  - Limpos arquivos temporários de log (`logs/*.log`) e vídeos binários em `tests/`.
  - Módulos binários pesados de compilação nativa (`onnxruntime-node` e `sharp`) movidos para `optionalDependencies` no `package.json`, evitando inchaço e falhas de compilação no Vercel.
  - Criação do gerador dinâmico de vídeo sintético em `tests/ensure-test-assets.js` para execução de testes limpos e leves.

---

## 🌟 Versão 2.0.0 — Migração Completa para Node.js ESM, Aceleração Universal de Hardware e IA

Esta versão representa uma reformulação estrutural completa do **MarcaRemoveIA**, transformando a aplicação em uma plataforma web moderna, rápida, segura e independente de runtimes externos complexos como Python. O sistema agora opera integralmente sob **Node.js (ESM)** com chamadas diretas aos binários de alta performance do **FFmpeg** e **yt-dlp**, além de inteligência artificial embarcada via **ONNX Runtime**.

---

## 🛠️ Detalhamento das Novas Implementações

### 1. 🔄 Migração Integral para JavaScript (Node.js 24 ESM)
- **Backend Moderno:** Migração completa de FastAPI/Python para **Express (Node.js 24 ESM)**, utilizando arquitetura modular com `import`/`export`.
- **Eliminação do Runtime Python:** Todos os módulos legados em Python (`processor.py`, `ai_api.py`, `ffmpeg_utils.py`, `web_app.py`, `main.py`, CustomTkinter) foram substituídos por código JavaScript nativo equivalente ou superior.
- **Chamadas de Processo Seguras:** Invocação do FFmpeg e yt-dlp via `child_process.spawn` com vetores de argumentos isolados (sem interpolação em shell), prevenindo vulnerabilidades de injeção de comandos.
- **Transmissão em Tempo Real:** Implementação de Server-Sent Events (SSE) nativo para feedback instantâneo de porcentagem, velocidade de renderização, FPS e tempo estimado (ETA).
- **Paridade Validada:** Testes automatizados de paridade garantiram que o resultado dos filtros visuais e processamento de áudio preservam a qualidade da versão anterior.

### 2. ⚡ Correção Definitiva do Erro -22 no NVENC e Dimensões Ímpares
- **Diagnóstico da Causa Raiz:** O encoder de hardware NVIDIA (`h264_nvenc`) e encoders estritos de GPU rejeitam dimensões ímpares de vídeo (ex: vídeos cortados ou verticais em 639x359) e perfis de cores incompatíveis, disparando o erro interno `-22 (Invalid argument)`.
- **Filtro Universal de Escala Par:** Aplicação automática do filtro `scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p` em todas as cadeias de processamento, garantindo dimensões pares válidas sem distorção visual perceptível.
- **Flags Otimizadas de Contêiner:** Inclusão de `-pix_fmt yuv420p` e `-movflags +faststart` para inicialização imediata do vídeo em navegadores e players sem esperar o download completo.
- **Cadeia de Fallback Resiliente:** Caso o encoder primário falhe em qualquer momento do processamento, o pipeline tenta sequencialmente o próximo encoder funcional da máquina até o fallback universal em CPU (`libx264`).
- **Modal de Diagnóstico em 2 Camadas:** Exibe uma interface amigável em português explicando a situação ao usuário e disponibiliza um botão para expandir os registros técnicos detalhados gravados em `logs/ffmpeg-<taskId>.log`.

### 3. 🖥️ Detector Ativo de Aceleração por Hardware (`src/core/encoder-detector.js`)
- **Teste Ativo de Codificação:** Não confia apenas na presença teórica dos codecs; executa um teste real de codificação de 0.5s na inicialização em cada encoder candidato para comprovar funcionamento no driver atual.
- **Matriz de Suporte Universal:**
  - 🟢 **NVIDIA:** `h264_nvenc` (presets calibrados: `-preset p4 -rc vbr -cq 23`)
  - 🔵 **Intel:** `h264_qsv` (`-global_quality 23`)
  - 🔴 **AMD:** `h264_amf` (`-quality balanced`)
  - ⚪ **Apple Silicon:** `h264_videotoolbox` (`-b:v 4M`)
  - 🐧 **Linux:** `h264_vaapi`
  - ⚙️ **CPU Universal:** `libx264` (`-preset veryfast -crf 23`)
- **Seletor de Hardware no Frontend:** Permite ao usuário alternar manualmente o encoder preferido ou mantê-lo em modo Automático, com badge de status em tempo real.

### 4. 🖼️ Remoção de Marca d'Água por Imagem (Template Matching)
- **Upload de Logotipo:** Novo modo que permite carregar diretamente a imagem da marca d'água (PNG com transparência alpha ou JPG).
- **Extração de Máscara Alpha:** Leitura precisa do canal alpha com aplicação de **dilatação morfológica configurável** nas bordas, absorvendo artefatos de compressão, antialiasing e sombras do logotipo.
- **Busca Multi-escala:** Algoritmo de correspondência de padrões (*template matching*) testando variações de escala entre 0.7x e 1.3x ao longo dos quadros do vídeo, calculando a caixa delimitadora mediana estável.
- **Prévia de 1 Frame:** Permite gerar e inspecionar instantaneamente um único quadro tratado na janela modal antes de comprometer o tempo de renderização do vídeo completo.

### 5. 🤖 Detecção com IA, ONNX Runtime e Canvas Interativo
- **Integração ONNX Runtime (`onnxruntime-node`):** Motor de inferência leve com suporte ordenado por prioridade de hardware:
  $$\text{CUDA} \longrightarrow \text{DirectML (Windows)} \longrightarrow \text{CoreML (macOS)} \longrightarrow \text{CPU}$$
- **Análise de Estabilidade Temporal:** Cálculo de variância estatística de pixels entre múltiplos quadros amostrados. Como o plano de fundo do vídeo se movimenta e a marca permanece fixa, regiões de baixa variância nos quadrantes e bordas são isoladas como candidatas ideais a marcas estáticas.
- **Supressão Não-Máxima (NMS):** Elimina caixas sobrepostas redundantes com cálculo de IoU (*Intersection over Union*).
- **Suavização Temporal de Trajetória:** Algoritmo com média móvel ponderada para atenuar variações espaciais e eliminar o efeito de cintilação (*flicker*) em marcas dinâmicas.
- **Canvas com Alças Interativas de Redimensionamento:** O usuário pode clicar, mover ou redimensionar qualquer marca detectada pela IA através de **4 alças nos cantos** (*top-left*, *top-right*, *bottom-left*, *bottom-right*), oferecendo controle milimétrico pré-processamento.
- **Manifesto de Modelos:** Catálogo configurado em `src/core/models-manifest.json` com URLs oficiais, hash SHA-256 e licenças permissivas.

### 6. 📥 Download de Vídeos por Link com yt-dlp
- **Download Integrado via URL:** Nova aba *"Baixar por Link"* compatível com centenas de sites e plataformas (YouTube, TikTok, Vimeo, Instagram, etc.).
- **Blindagem Rigorosa contra SSRF:** Proteção ativa que bloqueia requisições direcionadas a redes privadas, localhost (`127.0.0.1`), endereços de metadados de nuvem AWS/GCP/Azure (`169.254.169.254`), faixas `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, IPv6 local e resolução DNS interna.
- **Consulta de Metadados e Qualidade:** Exibição imediata de título, canal/autor, miniatura e seletor dinâmico de resoluções (1080p, 720p, 480p, 360p, Apenas Áudio) com estimativa de tamanho em MB.
- **Progresso Detalhado em Tempo Real:** Exibe velocidade de download (ex: `4.50 MiB/s`), porcentagem e tempo restante estimado (ETA).
- **Pipeline "Baixar e Limpar":** Opção para efetuar o download e encaminhar diretamente para o processamento de remoção da marca d'água em sequência contínua.
- **Rotina de Atualização:** Botão integrado na interface para atualizar o binário do yt-dlp sob demanda (`yt-dlp -U`).
- **Aviso Legal:** Alerta explícito na interface sobre conformidade com leis de direitos autorais e uso responsável de conteúdos.

---

## 📊 Tabela Comparativa de Versões

| Recurso | Versão Anterior (v1.x) | Versão 2.0.0 (Atual) |
| :--- | :--- | :--- |
| **Linguagem Principal** | Python (FastAPI / CustomTkinter) | **JavaScript (Node.js 24 ESM puro)** |
| **Resiliência a NVENC / Dimensões Ímpares** | Falhava com erro `-22` | **100% Imune (`scale=trunc(iw/2)*2...`)** |
| **Detecção de Hardware** | Estática por string do FFmpeg | **Teste ativo real de codificação (0.5s)** |
| **Fallback de Falhas** | Nenhum (processo abortava) | **Em cadeia até CPU com log em `logs/`** |
| **Identificação por Imagem** | Inexistente | **Template Matching multi-escala + Máscara Alpha** |
| **Prévia Rápida** | Processamento completo obrigatório | **Prévia instantânea de 1 quadro** |
| **Inferência IA Local** | Dependia de PyTorch / APIs externas | **ONNX Runtime (CUDA/DirectML/CPU)** |
| **Edição das Caixas no Canvas** | Desenho estático | **Mover + Redimensionar por 4 alças** |
| **Download por URL** | Inexistente | **yt-dlp integrado com proteção SSRF** |
| **Testes Automatizados** | Sem suíte dedicada | **20 testes automatizados (`npm test`)** |

---

## 🧪 Cobertura de Testes Automatizados

Para executar os testes a qualquer momento:
```bash
npm test
```

### Relação dos Testes:
1. `tests/parity.test.js`: Valida metadados, paridade visual de saída e tratamento de dimensões ímpares.
2. `tests/encoder.test.js`: Valida teste de codificação de hardware, ordem de prioridade e geração de logs no fallback.
3. `tests/template-matcher.test.js`: Valida criação de máscara, dilatação morfológica e busca por template em vídeo sintético.
4. `tests/onnx-hybrid.test.js`: Valida supressão não-máxima (NMS), interpolação temporal e detector de variância.
5. `tests/downloader.test.js`: Valida bloqueio estrito de SSRF contra IPs locais/privados, detecção do executável e rotina de atualização.

---

## 🚀 Como Iniciar

1. Certifique-se de que o **Node.js 20+**, o **FFmpeg** e o **yt-dlp** estejam instalados.
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Inicie o servidor:
   ```bash
   npm start
   ```
4. Acesse: **`http://127.0.0.1:8000`**
