import tkinter as tk
import cv2
from PIL import Image, ImageTk

class VideoCanvas(tk.Canvas):
    def __init__(self, master, on_box_created=None, **kwargs):
        super().__init__(master, bg="#1a1a1a", highlightthickness=0, **kwargs)
        self.on_box_created = on_box_created

        self.current_frame_rgb = None
        self.orig_w = 1
        self.orig_h = 1
        self.disp_w = 1
        self.disp_h = 1
        self.disp_x = 0
        self.disp_y = 0
        self.scale = 1.0

        self.tk_image = None
        self.boxes = [] # List of {"x": orig_x, "y": orig_y, "w": orig_w, "h": orig_h, "id": int}
        self.box_counter = 0

        # Mouse drag state
        self.is_dragging = False
        self.drag_start = (0, 0)
        self.current_drag_rect = None

        self.bind("<Configure>", self._on_resize)
        self.bind("<ButtonPress-1>", self._on_mouse_down)
        self.bind("<B1-Motion>", self._on_mouse_move)
        self.bind("<ButtonRelease-1>", self._on_mouse_up)

    def set_frame(self, frame_bgr):
        """Atualiza o frame exibido no canvas."""
        if frame_bgr is None:
            return
        self.orig_h, self.orig_w = frame_bgr.shape[:2]
        self.current_frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        self._render_frame()

    def _on_resize(self, event):
        self._render_frame()

    def _render_frame(self):
        if self.current_frame_rgb is None:
            return

        cw = self.winfo_width()
        ch = self.winfo_height()
        if cw < 50 or ch < 50:
            return

        # Calcula escala mantendo proporção (Aspect Ratio)
        scale_w = cw / float(self.orig_w)
        scale_h = ch / float(self.orig_h)
        self.scale = min(scale_w, scale_h)

        self.disp_w = int(self.orig_w * self.scale)
        self.disp_h = int(self.orig_h * self.scale)
        self.disp_x = (cw - self.disp_w) // 2
        self.disp_y = (ch - self.disp_h) // 2

        pil_img = Image.fromarray(self.current_frame_rgb).resize(
            (self.disp_w, self.disp_h), Image.Resampling.BILINEAR
        )
        self.tk_image = ImageTk.PhotoImage(pil_img)

        self.delete("all")
        self.create_image(self.disp_x, self.disp_y, anchor="nw", image=self.tk_image, tags="frame")
        self._redraw_boxes()

    def _to_orig_coords(self, canvas_x, canvas_y):
        """Converte coordenadas do canvas para resolução nativa do vídeo."""
        rel_x = (canvas_x - self.disp_x) / self.scale
        rel_y = (canvas_y - self.disp_y) / self.scale
        clamp_x = max(0, min(int(rel_x), self.orig_w - 1))
        clamp_y = max(0, min(int(rel_y), self.orig_h - 1))
        return clamp_x, clamp_y

    def _to_canvas_coords(self, orig_x, orig_y):
        """Converte coordenadas nativas do vídeo para o canvas."""
        cx = int(orig_x * self.scale) + self.disp_x
        cy = int(orig_y * self.scale) + self.disp_y
        return cx, cy

    def _on_mouse_down(self, event):
        if self.current_frame_rgb is None:
            return
        self.is_dragging = True
        self.drag_start = (event.x, event.y)

    def _on_mouse_move(self, event):
        if not self.is_dragging:
            return
        self.delete("temp_drag")
        x0, y0 = self.drag_start
        x1, y1 = event.x, event.y
        self.create_rectangle(x0, y0, x1, y1, outline="#00e5ff", width=2, dash=(4, 4), tags="temp_drag")

    def _on_mouse_up(self, event):
        if not self.is_dragging:
            return
        self.is_dragging = False
        self.delete("temp_drag")

        x0, y0 = self.drag_start
        x1, y1 = event.x, event.y

        cx1, cy1 = self._to_orig_coords(min(x0, x1), min(y0, y1))
        cx2, cy2 = self._to_orig_coords(max(x0, x1), max(y0, y1))

        box_w = cx2 - cx1
        box_h = cy2 - cy1

        # Ignora cliques acidentais muito pequenos
        if box_w > 5 and box_h > 5:
            self.box_counter += 1
            new_box = {
                "id": self.box_counter,
                "x": cx1,
                "y": cy1,
                "w": box_w,
                "h": box_h,
                "name": f"Marca #{self.box_counter}"
            }
            self.boxes.append(new_box)
            self._redraw_boxes()
            if self.on_box_created:
                self.on_box_created(new_box)

    def add_box(self, box):
        self.boxes.append(box)
        self._redraw_boxes()

    def remove_box(self, box_id):
        self.boxes = [b for b in self.boxes if b["id"] != box_id]
        self._redraw_boxes()

    def clear_boxes(self):
        self.boxes = []
        self._redraw_boxes()

    def _redraw_boxes(self):
        self.delete("saved_box")
        colors = ["#ff3366", "#00e5ff", "#ffbb00", "#a033ff", "#33ff77"]

        for idx, b in enumerate(self.boxes):
            c_x1, c_y1 = self._to_canvas_coords(b["x"], b["y"])
            c_x2, c_y2 = self._to_canvas_coords(b["x"] + b["w"], b["y"] + b["h"])
            color = colors[idx % len(colors)]

            # Desenha retângulo delimitador
            self.create_rectangle(
                c_x1, c_y1, c_x2, c_y2,
                outline=color, width=2, tags="saved_box"
            )
            # Tag com nome e dimensões
            tag_text = f"{b.get('name', 'Marca')} ({b['w']}x{b['h']})"
            self.create_text(
                c_x1 + 4, c_y1 - 10,
                text=tag_text, anchor="nw",
                fill=color, font=("Segoe UI", 9, "bold"),
                tags="saved_box"
            )
