import os
import sys
import threading
import subprocess
import cv2
import customtkinter as ctk
from tkinter import filedialog, messagebox

from core.ffmpeg_utils import check_nvenc_available, get_video_metadata, get_ffmpeg_dir, get_fullhd_dimensions
from core.processor import WatermarkProcessor
from core.ai_api import load_ai_config, save_ai_config, detect_watermarks_ai
from .canvas_widget import VideoCanvas

ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")

class MainWindow(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("MarcaRemoveIA - Remoção e Preenchimento com Inteligência Artificial")
        self.geometry("1220x800")
        self.minsize(1020, 720)

        # Estado
        self.video_path = None
        self.output_path = None
        self.cap = None
        self.meta = None
        self.total_frames = 0
        self.fps = 30.0
        self.current_frame = None
        self.current_frame_idx = 0
        self.processor = WatermarkProcessor()
        self.last_output_file = None
        self.ai_config = load_ai_config()

        self._build_ui()
        self._check_hardware()

    def _check_hardware(self):
        has_nvenc = check_nvenc_available()
        if has_nvenc:
            self.lbl_hw_status.configure(
                text="⚡ Aceleração GPU NVIDIA (NVENC) Ativa",
                text_color="#00ffcc"
            )
        else:
            self.lbl_hw_status.configure(
                text="ℹ️ Modo CPU Ativo",
                text_color="#ffbb00"
            )

    def _build_ui(self):
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # ==========================================
        # PAINEL LATERAL ESQUERDO
        # ==========================================
        self.sidebar = ctk.CTkFrame(self, width=330, corner_radius=0)
        self.sidebar.grid(row=0, column=0, sticky="nsew", padx=0, pady=0)
        self.sidebar.grid_propagate(False)

        # Cabeçalho
        lbl_app_title = ctk.CTkLabel(
            self.sidebar, text="MarcaRemoveIA",
            font=ctk.CTkFont(size=22, weight="bold")
        )
        lbl_app_title.pack(padx=20, pady=(20, 2), anchor="w")

        lbl_app_sub = ctk.CTkLabel(
            self.sidebar, text="IA Generativa & Video Inpainting",
            font=ctk.CTkFont(size=12), text_color="#00e5ff"
        )
        lbl_app_sub.pack(padx=20, pady=(0, 10), anchor="w")

        self.lbl_hw_status = ctk.CTkLabel(
            self.sidebar, text="Detectando hardware...",
            font=ctk.CTkFont(size=11, weight="bold")
        )
        self.lbl_hw_status.pack(padx=20, pady=(0, 10), anchor="w")

        # Botão Abrir Vídeo
        self.btn_open = ctk.CTkButton(
            self.sidebar, text="📁 Abrir Vídeo...",
            font=ctk.CTkFont(size=13, weight="bold"),
            height=36, command=self._on_open_video
        )
        self.btn_open.pack(padx=20, pady=(0, 10), fill="x")

        # Botão Detectar com IA
        self.btn_ai_detect = ctk.CTkButton(
            self.sidebar, text="✨ Detectar Marcas com IA",
            font=ctk.CTkFont(size=13, weight="bold"),
            fg_color="#6200ea", hover_color="#4500b5",
            height=36, command=self._on_ai_detect_click, state="disabled"
        )
        self.btn_ai_detect.pack(padx=20, pady=(0, 10), fill="x")

        # Informações do Vídeo
        self.frame_info = ctk.CTkFrame(self.sidebar, fg_color="#2b2b2b")
        self.frame_info.pack(padx=20, pady=(0, 10), fill="x")

        self.lbl_video_info = ctk.CTkLabel(
            self.frame_info, text="Nenhum vídeo carregado",
            font=ctk.CTkFont(size=11), justify="left", wraplength=270
        )
        self.lbl_video_info.pack(padx=10, pady=8, anchor="w")

        # Card de Destino de Salvamento
        self.frame_dest = ctk.CTkFrame(self.sidebar, fg_color="#222222")
        self.frame_dest.pack(padx=20, pady=(0, 10), fill="x")

        lbl_dest_title = ctk.CTkLabel(self.frame_dest, text="💾 Salvar vídeo em:", font=ctk.CTkFont(size=11, weight="bold"), text_color="lightgray")
        lbl_dest_title.pack(padx=10, pady=(6, 2), anchor="w")

        self.lbl_dest_path = ctk.CTkLabel(self.frame_dest, text="Mesma pasta do vídeo original", font=ctk.CTkFont(size=10), text_color="gray", wraplength=270, justify="left")
        self.lbl_dest_path.pack(padx=10, pady=(0, 4), anchor="w")

        self.btn_change_dest = ctk.CTkButton(
            self.frame_dest, text="Alterar Pasta / Nome...", height=22, font=ctk.CTkFont(size=10),
            fg_color="#3a3a3a", hover_color="#4a4a4a", command=self._change_destination, state="disabled"
        )
        self.btn_change_dest.pack(padx=10, pady=(0, 6), fill="x")

        # Lista de Marcas
        lbl_boxes = ctk.CTkLabel(self.sidebar, text="Regiões Identificadas:", font=ctk.CTkFont(size=12, weight="bold"))
        lbl_boxes.pack(padx=20, pady=(0, 2), anchor="w")

        self.box_list_frame = ctk.CTkScrollableFrame(self.sidebar, height=95, fg_color="#222222")
        self.box_list_frame.pack(padx=20, pady=(0, 6), fill="x")

        self.lbl_no_boxes = ctk.CTkLabel(
            self.box_list_frame, text="Desenhe um retângulo ou use\n'Detectar Marcas com IA'.",
            font=ctk.CTkFont(size=11), text_color="gray"
        )
        self.lbl_no_boxes.pack(pady=10)

        self.btn_clear_boxes = ctk.CTkButton(
            self.sidebar, text="🗑️ Limpar Marcas",
            height=22, fg_color="#444444", hover_color="#555555",
            font=ctk.CTkFont(size=11), command=self._clear_all_boxes
        )
        self.btn_clear_boxes.pack(padx=20, pady=(0, 8), fill="x")

        # Motor de Inpainting
        lbl_engine = ctk.CTkLabel(self.sidebar, text="Motor de Preenchimento:", font=ctk.CTkFont(size=12, weight="bold"))
        lbl_engine.pack(padx=20, pady=(0, 2), anchor="w")

        self.combo_engine = ctk.CTkComboBox(
            self.sidebar,
            values=[
                "✨ IA Generativa (Reconstrução 100% Pixels)",
                "⚡ GPU NVIDIA NVENC + Delogo",
                "🖥️ CPU FFmpeg (Delogo)",
                "🎨 OpenCV Telea",
                "🌊 OpenCV Navier-Stokes"
            ]
        )
        self.combo_engine.set("✨ IA Generativa (Reconstrução 100% Pixels)")
        self.combo_engine.pack(padx=20, pady=(0, 8), fill="x")

        # Opções de Qualidade, Upscale e Áudio
        self.chk_audio = ctk.CTkCheckBox(self.sidebar, text="Preservar Áudio Original")
        self.chk_audio.select()
        self.chk_audio.pack(padx=20, pady=(0, 6), anchor="w")

        self.chk_upscale = ctk.CTkCheckBox(
            self.sidebar, text="✨ Upscale Full HD (1080p) IA",
            command=self._on_upscale_toggled
        )
        self.chk_upscale.pack(padx=20, pady=(0, 10), anchor="w")

        # Botão Configurar API de IA
        self.btn_config_api = ctk.CTkButton(
            self.sidebar, text="⚙️ Configurar Chave de API da IA",
            height=26, fg_color="#333333", hover_color="#444444", font=ctk.CTkFont(size=11),
            command=self._open_api_settings_dialog
        )
        self.btn_config_api.pack(padx=20, pady=(0, 10), fill="x")

        # Ações de Execução
        self.btn_start = ctk.CTkButton(
            self.sidebar, text="🚀 Iniciar Remoção com IA",
            height=42, fg_color="#107c41", hover_color="#0e6b37",
            font=ctk.CTkFont(size=14, weight="bold"),
            command=self._start_processing, state="disabled"
        )
        self.btn_start.pack(padx=20, pady=(0, 6), fill="x")

        self.btn_cancel = ctk.CTkButton(
            self.sidebar, text="Cancelar",
            height=28, fg_color="#a80000", hover_color="#850000",
            command=self._cancel_processing, state="disabled"
        )
        self.btn_cancel.pack(padx=20, pady=(0, 10), fill="x")

        # ==========================================
        # PAINEL PRINCIPAL DIREITO
        # ==========================================
        self.main_content = ctk.CTkFrame(self, fg_color="#151515")
        self.main_content.grid(row=0, column=1, sticky="nsew", padx=10, pady=10)
        self.main_content.grid_rowconfigure(0, weight=1)
        self.main_content.grid_columnconfigure(0, weight=1)

        self.canvas = VideoCanvas(self.main_content, on_box_created=self._on_box_added)
        self.canvas.grid(row=0, column=0, sticky="nsew", padx=5, pady=5)

        # Barra Inferior
        self.bottom_bar = ctk.CTkFrame(self.main_content, fg_color="#1f1f1f")
        self.bottom_bar.grid(row=1, column=0, sticky="ew", padx=5, pady=5)
        self.bottom_bar.grid_columnconfigure(1, weight=1)

        lbl_time = ctk.CTkLabel(self.bottom_bar, text="Linha do Tempo:", font=ctk.CTkFont(size=12))
        lbl_time.grid(row=0, column=0, padx=(10, 5), pady=6, sticky="w")

        self.slider_timeline = ctk.CTkSlider(self.bottom_bar, from_=0, to=100, command=self._on_slider_moved)
        self.slider_timeline.set(0)
        self.slider_timeline.grid(row=0, column=1, padx=10, pady=6, sticky="ew")

        self.lbl_frame_counter = ctk.CTkLabel(self.bottom_bar, text="0 / 0", font=ctk.CTkFont(size=11), width=90)
        self.lbl_frame_counter.grid(row=0, column=2, padx=(5, 10), pady=6)

        self.progress_bar = ctk.CTkProgressBar(self.bottom_bar)
        self.progress_bar.set(0)
        self.progress_bar.grid(row=1, column=0, columnspan=3, padx=10, pady=(4, 4), sticky="ew")

        # Container de Status & Conclusão
        self.frame_status_container = ctk.CTkFrame(self.bottom_bar, fg_color="transparent")
        self.frame_status_container.grid(row=2, column=0, columnspan=3, padx=10, pady=(0, 6), sticky="ew")
        self.frame_status_container.grid_columnconfigure(0, weight=1)

        self.lbl_status = ctk.CTkLabel(
            self.frame_status_container,
            text="Pronto. Carregue um vídeo para iniciar a remoção com IA.",
            font=ctk.CTkFont(size=12), text_color="lightgray"
        )
        self.lbl_status.grid(row=0, column=0, sticky="w")

        # Botões de Ação Final (Aparecem quando concluído)
        self.frame_completion_buttons = ctk.CTkFrame(self.frame_status_container, fg_color="transparent")
        self.btn_open_folder = ctk.CTkButton(
            self.frame_completion_buttons, text="📂 Abrir Pasta", width=110, height=26,
            fg_color="#0284c7", hover_color="#0369a1", font=ctk.CTkFont(size=11, weight="bold"),
            command=self._open_output_folder
        )
        self.btn_open_folder.pack(side="left", padx=4)

        self.btn_play_video = ctk.CTkButton(
            self.frame_completion_buttons, text="▶️ Assistir Vídeo", width=120, height=26,
            fg_color="#107c41", hover_color="#0e6b37", font=ctk.CTkFont(size=11, weight="bold"),
            command=self._play_output_video
        )
        self.btn_play_video.pack(side="left", padx=4)

    def _open_api_settings_dialog(self):
        dialog = ctk.CTkToplevel(self)
        dialog.title("Configurações da API de IA")
        dialog.geometry("480x360")
        dialog.grab_set()

        lbl = ctk.CTkLabel(dialog, text="Configurar Provedor de IA", font=ctk.CTkFont(size=16, weight="bold"))
        lbl.pack(pady=(15, 10))

        lbl_p = ctk.CTkLabel(dialog, text="Provedor:", font=ctk.CTkFont(size=12))
        lbl_p.pack(anchor="w", padx=30, pady=(5, 2))

        combo_p = ctk.CTkComboBox(dialog, values=["gemini", "openai", "local_cv"])
        combo_p.set(self.ai_config.get("provider", "gemini"))
        combo_p.pack(fill="x", padx=30, pady=(0, 10))

        lbl_k = ctk.CTkLabel(dialog, text="Chave de API (Google Gemini / OpenAI):", font=ctk.CTkFont(size=12))
        lbl_k.pack(anchor="w", padx=30, pady=(5, 2))

        entry_k = ctk.CTkEntry(dialog, placeholder_text="Cole sua chave de API aqui...", show="*")
        entry_k.insert(0, self.ai_config.get("api_key", ""))
        entry_k.pack(fill="x", padx=30, pady=(0, 15))

        lbl_info = ctk.CTkLabel(
            dialog,
            text="💡 O modo 'local_cv' não necessita de chave de API e roda 100% offline.\nCom a chave do Google Gemini (gratuita), a IA analisa os frames com precisão máxima.",
            font=ctk.CTkFont(size=11), text_color="gray", justify="left", wraplength=420
        )
        lbl_info.pack(padx=30, pady=(0, 20))

        def save():
            self.ai_config["provider"] = combo_p.get()
            self.ai_config["api_key"] = entry_k.get().strip()
            save_ai_config(self.ai_config)
            messagebox.showinfo("Salvo", "Configurações da API de IA atualizadas com sucesso!")
            dialog.destroy()

        btn_save = ctk.CTkButton(dialog, text="Salvar Configurações", command=save, fg_color="#107c41")
        btn_save.pack(pady=10)

    def _on_open_video(self):
        file_path = filedialog.askopenfilename(
            title="Selecione um Vídeo",
            filetypes=[("Arquivos de Vídeo", "*.mp4 *.mkv *.avi *.mov *.wmv *.webm"), ("Todos", "*.*")]
        )
        if not file_path:
            return

        self.video_path = file_path
        if self.cap:
            self.cap.release()

        self.cap = cv2.VideoCapture(file_path)
        if not self.cap.isOpened():
            messagebox.showerror("Erro", "Não foi possível abrir o arquivo de vídeo.")
            return

        self.meta = get_video_metadata(file_path)
        if not self.meta:
            self.meta = {
                "width": int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                "height": int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
                "fps": self.cap.get(cv2.CAP_PROP_FPS) or 30.0,
                "nb_frames": int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT)),
                "duration": 0,
                "video_codec": "desconhecido",
                "has_audio": True
            }

        self.total_frames = max(1, self.meta["nb_frames"])
        self.fps = self.meta["fps"]

        # Define automaticamente o nome e pasta de destino para não abrir explorer confuso
        base, ext = os.path.splitext(file_path)
        self.output_path = f"{base}_sem_marca_ia.mp4"
        self.lbl_dest_path.configure(text=os.path.basename(self.output_path), text_color="#00e5ff")
        self.btn_change_dest.configure(state="normal")

        filename = os.path.basename(file_path)
        self._update_video_info_display()

        self.slider_timeline.configure(from_=0, to=self.total_frames - 1)
        self.slider_timeline.set(0)
        self._show_frame_by_index(0)

        # Oculta botões de conclusão anteriores
        self.frame_completion_buttons.grid_forget()

        self.btn_start.configure(state="normal")
        self.btn_ai_detect.configure(state="normal")
        self.lbl_status.configure(
            text="Vídeo carregado. Clique em '✨ Detectar Marcas com IA' ou selecione manualmente desenhando com o mouse.",
            text_color="lightgray"
        )

    def _update_video_info_display(self):
        if not self.meta or not self.video_path:
            return
        filename = os.path.basename(self.video_path)
        dur_min = int(self.meta["duration"] // 60)
        dur_sec = int(self.meta["duration"] % 60)
        w, h = self.meta["width"], self.meta["height"]

        if bool(self.chk_upscale.get()):
            fhd_w, fhd_h = get_fullhd_dimensions(w, h)
            res_str = f"📐 Original: {w}x{h} ➔ Full HD: {fhd_w}x{fhd_h} (IA)"
        else:
            res_str = f"📐 Resolução: {w}x{h}"

        self.lbl_video_info.configure(
            text=f"📄 {filename}\n{res_str} | ⏱️ {dur_min:02d}:{dur_sec:02d}\n🎞️ {self.fps:.2f} FPS | Codec: {self.meta['video_codec']}"
        )

    def _on_upscale_toggled(self):
        self._update_video_info_display()

    def _change_destination(self):
        if not self.video_path:
            return
        initial_name = os.path.basename(self.output_path) if self.output_path else "video_limpo.mp4"
        new_path = filedialog.asksaveasfilename(
            title="Escolha onde salvar o vídeo sem marca d'água",
            initialfile=initial_name,
            defaultextension=".mp4",
            filetypes=[("Vídeo MP4", "*.mp4"), ("Todos", "*.*")]
        )
        if new_path:
            self.output_path = new_path
            self.lbl_dest_path.configure(text=os.path.basename(self.output_path), text_color="#00e5ff")

    def _show_frame_by_index(self, frame_idx):
        if not self.cap:
            return
        self.cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = self.cap.read()
        if ret:
            self.current_frame = frame
            self.current_frame_idx = frame_idx
            self.canvas.set_frame(frame)
            self.lbl_frame_counter.configure(text=f"{frame_idx + 1} / {self.total_frames}")

    def _on_slider_moved(self, value):
        self._show_frame_by_index(int(value))

    def _on_ai_detect_click(self):
        if self.current_frame is None:
            return

        self.lbl_status.configure(text="🤖 IA analisando o frame em busca de marcas d'água...", text_color="#00e5ff")
        self.btn_ai_detect.configure(state="disabled")

        def task():
            boxes = detect_watermarks_ai(self.current_frame, self.ai_config)
            self.after(0, self._on_ai_detect_finished, boxes)

        threading.Thread(target=task, daemon=True).start()

    def _on_ai_detect_finished(self, boxes):
        self.btn_ai_detect.configure(state="normal")
        if not boxes:
            self.lbl_status.configure(text="Nenhuma marca d'água óbvia identificada pela IA. Você pode desenhar manualmente.", text_color="#ffbb00")
            messagebox.showinfo("Detecção IA", "Nenhuma marca d'água foi identificada com certeza. Você pode selecionar a área desenhando com o mouse.")
            return

        for b in boxes:
            self.canvas.add_box(b)
        self._refresh_box_list()

        count = len(boxes)
        self.lbl_status.configure(
            text=f"✅ IA identificou {count} marca(s) d'água com sucesso!",
            text_color="#00ffcc"
        )

    def _on_box_added(self, box):
        self._refresh_box_list()

    def _clear_all_boxes(self):
        self.canvas.clear_boxes()
        self._refresh_box_list()

    def _refresh_box_list(self):
        for widget in self.box_list_frame.winfo_children():
            widget.destroy()

        if not self.canvas.boxes:
            lbl = ctk.CTkLabel(
                self.box_list_frame, text="Desenhe um retângulo ou use\n'Detectar Marcas com IA'.",
                font=ctk.CTkFont(size=11), text_color="gray"
            )
            lbl.pack(pady=10)
            return

        for b in self.canvas.boxes:
            item = ctk.CTkFrame(self.box_list_frame, fg_color="#2b2b2b")
            item.pack(fill="x", pady=2, padx=2)

            info = f"{b['name']} ({b['w']}x{b['h']})"
            lbl = ctk.CTkLabel(item, text=info, font=ctk.CTkFont(size=10))
            lbl.pack(side="left", padx=5)

            btn_del = ctk.CTkButton(
                item, text="✕", width=22, height=18,
                fg_color="#882222", hover_color="#aa3333",
                command=lambda box_id=b["id"]: self._remove_box_by_id(box_id)
            )
            btn_del.pack(side="right", padx=5)

    def _remove_box_by_id(self, box_id):
        self.canvas.remove_box(box_id)
        self._refresh_box_list()

    def _start_processing(self):
        if not self.video_path or not self.canvas.boxes:
            messagebox.showwarning("Aviso", "Selecione ou detecte pelo menos uma marca d'água antes de iniciar.")
            return

        # Garante que o arquivo de destino não sobrescreva acidentalmente o vídeo original
        if not self.output_path or os.path.abspath(self.output_path) == os.path.abspath(self.video_path):
            base, ext = os.path.splitext(self.video_path)
            self.output_path = f"{base}_sem_marca_ia.mp4"

        save_path = self.output_path
        self.last_output_file = save_path

        engine_str = self.combo_engine.get()
        if "IA Generativa" in engine_str:
            engine = "ai_generative"
        elif "GPU" in engine_str:
            engine = "gpu_nvenc"
        elif "CPU" in engine_str:
            engine = "cpu_delogo"
        elif "Telea" in engine_str:
            engine = "opencv_telea"
        else:
            engine = "opencv_ns"

        keep_audio = bool(self.chk_audio.get())
        upscale_fullhd = bool(self.chk_upscale.get())

        self.btn_start.configure(state="disabled")
        self.btn_open.configure(state="disabled")
        self.btn_ai_detect.configure(state="disabled")
        self.btn_change_dest.configure(state="disabled")
        self.btn_cancel.configure(state="normal")
        self.frame_completion_buttons.grid_forget()
        self.progress_bar.set(0)
        self.lbl_status.configure(text="Iniciando remoção com IA...", text_color="#00e5ff")

        thread = threading.Thread(
            target=self._worker_thread,
            args=(self.video_path, save_path, list(self.canvas.boxes), engine, "high", keep_audio, upscale_fullhd),
            daemon=True
        )
        thread.start()

    def _worker_thread(self, in_file, out_file, boxes, engine, quality, keep_audio, upscale_fullhd):
        def progress_cb(pct, cur_f, tot_f, fps_val, eta_str):
            self.after(0, self._update_progress_ui, pct, cur_f, tot_f, fps_val, eta_str)

        success = False
        error_msg = None
        try:
            success = self.processor.run_removal(
                input_video=in_file,
                output_video=out_file,
                watermark_boxes=boxes,
                engine=engine,
                quality=quality,
                keep_audio=keep_audio,
                upscale_fullhd=upscale_fullhd,
                progress_callback=progress_cb
            )
        except Exception as e:
            error_msg = str(e)

        self.after(0, self._on_processing_finished, success, error_msg, out_file)

    def _update_progress_ui(self, pct, cur_f, tot_f, fps_val, eta_str):
        self.progress_bar.set(pct)
        status_text = (
            f"Processando com IA: {pct*100:.1f}% | "
            f"Frame: {cur_f}/{tot_f} | "
            f"Velocidade: {fps_val:.1f} fps | "
            f"Tempo Restante: {eta_str}"
        )
        self.lbl_status.configure(text=status_text)

    def _cancel_processing(self):
        self.processor.cancel()
        self.lbl_status.configure(text="Cancelando...", text_color="#ffbb00")

    def _on_processing_finished(self, success, error_msg, out_file):
        self.btn_start.configure(state="normal")
        self.btn_open.configure(state="normal")
        self.btn_ai_detect.configure(state="normal")
        self.btn_change_dest.configure(state="normal")
        self.btn_cancel.configure(state="disabled")

        if success and os.path.exists(out_file) and os.path.getsize(out_file) > 1000:
            self.progress_bar.set(1.0)
            size_mb = os.path.getsize(out_file) / (1024 * 1024)
            self.lbl_status.configure(
                text=f"✅ Concluído com sucesso! Salvo: {os.path.basename(out_file)} ({size_mb:.1f} MB)",
                text_color="#00ffcc"
            )
            # Exibe os botões de ação final (Abrir Pasta e Assistir Vídeo)
            self.frame_completion_buttons.grid(row=0, column=1, sticky="e", padx=(10, 0))

            messagebox.showinfo(
                "Processamento Concluído!",
                f"O vídeo foi renderizado com sucesso pela IA!\n\nArquivo:\n{out_file}\n\nTamanho: {size_mb:.1f} MB"
            )
        elif self.processor.cancel_requested:
            self.lbl_status.configure(text="Cancelado pelo usuário.", text_color="#ffbb00")
            messagebox.showinfo("Cancelado", "A operação foi cancelada.")
        else:
            self.lbl_status.configure(text="Erro no processamento.", text_color="#ff4444")
            err = error_msg or "Falha ao renderizar o vídeo."
            messagebox.showerror("Erro no Processamento", f"Ocorreu um erro ao gerar o vídeo:\n\n{err}")

    def _open_output_folder(self):
        if not self.last_output_file or not os.path.exists(self.last_output_file):
            return
        try:
            norm_path = os.path.normpath(self.last_output_file)
            # Abre o explorer com o arquivo selecionado com aspas seguras para caminhos com espaços
            subprocess.run(f'explorer /select,"{norm_path}"')
        except Exception:
            try:
                os.startfile(os.path.dirname(norm_path))
            except Exception as e:
                messagebox.showerror("Erro", f"Não foi possível abrir a pasta:\n{e}")

    def _play_output_video(self):
        if not self.last_output_file or not os.path.exists(self.last_output_file):
            return
        try:
            norm_path = os.path.normpath(self.last_output_file)
            os.startfile(norm_path)
        except Exception as e:
            messagebox.showerror("Erro", f"Não foi possível abrir o player:\n{e}")
