# 🚀 MarcaRemoveIA

> **Removedor Inteligente de Marcas d'Água para Vídeos com IA Generativa e Aceleração GPU Nativa (Desktop Windows & Web).**

[![Python Version](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6.svg)](https://microsoft.com)
[![Acceleration](https://img.shields.io/badge/GPU-NVIDIA%20NVENC-76B900.svg)](https://developer.nvidia.com/video-encode-decode-gpu-support-matrix)
[![FastAPI](https://img.shields.io/badge/Web-FastAPI-009688.svg)](https://fastapi.tiangolo.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

O **MarcaRemoveIA** é uma solução completa inspirada em serviços de nuvem como *watermarkremover.io*, desenvolvida para rodar **nativamente no Windows** e também como **Aplicação Web**. Ele utiliza Inteligência Artificial para detectar e preencher 100% das áreas de marcas d'água, logotipos, legendas e carimbos de data/hora, gerando novos pixels realistas com base no contexto do vídeo.

---

## ✨ Recursos Principais

- 🤖 **Detecção Automática com IA (API Vision & Local CV)**:
  - Integração com **Google Gemini API** e **OpenAI GPT-4o Vision** para localizar marcas d'água em segundos.
  - Modo **Visão Computacional Local** inteligente (funciona 100% offline sem custos de API).
- 🎨 **Preenchimento Generativo de Pixels (100% Reconstrução)**:
  - Gera novos pixels preservando texturas, bordas e iluminação do fundo.
- ⚡ **Aceleração por Hardware GPU NVIDIA (NVENC)**:
  - Suporte a encoders NVENC (`h264_nvenc`, `hevc_nvenc`) com velocidades que superam **160 frames por segundo**.
- 🖥️ **Edição Desktop Nativa (Windows)**:
  - Interface moderna em **CustomTkinter** com Dark Mode, linha do tempo interativa e seleção de múltiplas marcas.
- 🌐 **Edição Web (FastAPI + HTML5/Tailwind)**:
  - Navegue e remova marcas diretamente pelo navegador via `http://localhost:8000`.
- 🎵 **Áudio Perfeito e Universal**:
  - Decodificação e recodificação estéreo em AAC cristalino (192 kbps, 44.1 kHz), garantindo 100% de compatibilidade em todos os players do Windows e navegadores.
- 📺 **Upscale Full HD (1080p) com Nitidez por IA**:
  - Opção de super-resolução com interpolação geométrica Lanczos-4 e máscara de realce de nitidez (*unsharp mask*), convertendo vídeos verticais (720x1280 ➔ 1080x1920) e horizontais (1280x720 ➔ 1920x1080) com qualidade Full HD profissional.
- 📦 **Executável Portátil (.exe)**:
  - Pode ser empacotado em um executável autônomo com FFmpeg embutido.

---

## 📁 Estrutura do Projeto

```text
MarcaRemoveIA/
├── core/
│   ├── ai_api.py            # Módulo de detecção e inpainting com IA (Gemini/OpenAI/CV)
│   ├── ffmpeg_utils.py      # Localização de FFmpeg e análise de metadados
│   └── processor.py         # Motor de processamento (GPU NVENC, CPU, IA)
├── gui/
│   ├── canvas_widget.py     # Canvas interativo para desenhar e visualizar marcas
│   └── main_window.py       # Interface Desktop CustomTkinter
├── templates/
│   └── index.html           # Interface Web moderna em TailwindCSS
├── main.py                  # Ponto de entrada do App Desktop
├── web_app.py               # Servidor Web FastAPI
├── build_exe.py             # Script de compilação PyInstaller
├── run.bat                  # Atalho para iniciar App Desktop
├── run_web.bat              # Atalho para iniciar App Web
├── build.bat                # Atalho para compilar o executável
├── requirements.txt         # Dependências do projeto
├── .gitignore               # Arquivos ignorados pelo Git
└── LICENSE                  # Licença MIT
```

---

## 🛠️ Instalação e Requisitos

### Pré-requisitos
- **Windows 10 ou 11 (64-bit)**
- **Python 3.10 ou superior**
- *(Opcional)* Placa de vídeo NVIDIA (série GTX/RTX) com drivers atualizados para aceleração NVENC.

### Instalando as dependências
Abra o PowerShell ou Prompt de Comando na pasta do projeto e execute:
```powershell
pip install -r requirements.txt
```

---

## 🚀 Como Executar

### 1. Aplicativo Desktop (Interface Windows)
Dê duplo clique em `run.bat` ou rode no terminal:
```powershell
python main.py
```

### 2. Aplicativo Web (Navegador)
Dê duplo clique em `run_web.bat` ou rode no terminal:
```powershell
python web_app.py
```
Em seguida, abra o navegador em: **`http://127.0.0.1:8000`**

---

## ⚙️ Configuração das APIs de IA

O **MarcaRemoveIA** funciona perfeitamente sem chave de API (usando o detector de visão computacional local). Para ativar a máxima precisão de detecção com modelos de ponta:

1. Clique em **"⚙️ Configurar Chave de API da IA"** no app (ou na interface Web).
2. Selecione o provedor:
   - **Google Gemini**: [Obtenha sua chave gratuita no Google AI Studio](https://aistudio.google.com/)
   - **OpenAI**: Utilize sua chave da plataforma OpenAI.
3. Clique em **Salvar**. A chave fica salva localmente em `config.json` (arquivo protegido e ignorado pelo `.gitignore`).

---

## 📦 Como Gerar o Executável (.exe)

Para gerar uma versão autônoma que roda em qualquer computador com Windows sem exigir Python instalado:
1. Dê duplo clique em `build.bat` ou execute:
```powershell
python build_exe.py
```
2. O executável final estará pronto em:
```text
dist\MarcaRemoveIA\MarcaRemoveIA.exe
```

---

## 📤 Informações Importantes para Subir no GitHub

Ao enviar este projeto para o GitHub, siga as boas práticas abaixo:

### 1. Inicializar e Enviar para o GitHub
```powershell
# 1. Inicialize o repositório Git
git init

# 2. Defina o branch principal
git branch -M main

# 3. Adicione todos os arquivos de código
git add .

# 4. Crie o primeiro commit
git commit -m "feat: lancamento inicial do MarcaRemoveIA (Desktop + Web)"

# 5. Conecte ao seu repositório no GitHub (substitua pela sua URL)
git remote add origin https://github.com/SEU-USUARIO/MarcaRemoveIA.git

# 6. Envie os arquivos
git push -u origin main
```

### 2. ⚠️ O que NUNCA subir no Git (já protegido pelo `.gitignore`):
- **Chaves de API** (`config.json`): Já incluído no `.gitignore` para nunca vazar seus tokens.
- **Vídeos grandes** (`*.mp4`, `web_uploads/`, `web_outputs/`): Repositórios Git têm limites de 100MB por arquivo.
- **Binários compilados** (`dist/`, `build/`, `bin/ffmpeg.exe`): Binários pesados de 100MB+ não devem ser enviados como commits normais.

### 3. Como Distribuir o Executável (.exe) para seus Usuários:
Em vez de enviar os arquivos `.exe` e `ffmpeg.exe` para o repositório de código, utilize os **GitHub Releases**:
1. No seu repositório no GitHub, clique na aba **Releases** à direita e depois em **Draft a new release**.
2. Defina uma tag (ex.: `v1.0.0`).
3. Compacte a pasta `dist\MarcaRemoveIA` em um arquivo `.zip` (ex.: `MarcaRemoveIA-v1.0.0-Windows.zip`).
4. Arraste o arquivo `.zip` para a área de anexos da Release e clique em **Publish release**.
5. Seus usuários poderão baixar o `.zip` pronto para usar com um clique!

---

## 📄 Licença

Distribuído sob a licença **MIT**. Veja [`LICENSE`](LICENSE) para mais detalhes.
