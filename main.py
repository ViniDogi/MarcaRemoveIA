import os
import sys
import ctypes

def enable_windows_dpi():
    """Habilita nitidez e alta definição (Per-Monitor DPI Awareness) no Windows."""
    if os.name == 'nt':
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2) # Per-monitor DPI aware
        except Exception:
            try:
                ctypes.windll.user32.SetProcessDPIAware()
            except Exception:
                pass

def main():
    enable_windows_dpi()

    # Adiciona o diretório base ao sys.path para garantir importações relativas e absolutas
    base_dir = os.path.dirname(os.path.abspath(__file__))
    if base_dir not in sys.path:
        sys.path.insert(0, base_dir)

    from gui.main_window import MainWindow

    app = MainWindow()
    app.mainloop()

if __name__ == "__main__":
    main()
