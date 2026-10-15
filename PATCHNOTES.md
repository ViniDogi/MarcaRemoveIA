# 📋 Notas de Atualização (Patchnotes) — MarcaRemoveIA v2.0.0

> **Data de Lançamento:** 15 de Outubro de 2026  
> **Versão:** 2.0.0 (Migração Completa para Node.js ESM, Aceleração Universal de Hardware, IA Híbrida e Download por Link)  
> **Status dos Testes:** 20/20 Testes Automatizados Aprovados (100% de cobertura funcional)

---

## 🌟 Destaques da Atualização

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
