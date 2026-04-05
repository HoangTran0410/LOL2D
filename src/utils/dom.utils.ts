const DomUtils = {
  preventRightClick(element: HTMLElement) {
    element.addEventListener('contextmenu', event => event.preventDefault());
  },
  preventZoom() {
    document.addEventListener(
      'wheel',
      event => {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
        }
      },
      { passive: false }
    );
  },
  goFullscreen() {
    const element = document.documentElement;
    if (element.requestFullscreen) element.requestFullscreen();
    else if ((element as any).mozRequestFullScreen) (element as any).mozRequestFullScreen();
    else if ((element as any).webkitRequestFullscreen) (element as any).webkitRequestFullscreen();
    else if ((element as any).msRequestFullscreen) (element as any).msRequestFullscreen();
  },
  exitFullscreen() {
    if (document.exitFullscreen) document.exitFullscreen();
    else if ((document as any).mozCancelFullScreen) (document as any).mozCancelFullScreen();
    else if ((document as any).webkitExitFullscreen) (document as any).webkitExitFullscreen();
    else if ((document as any).msExitFullscreen) (document as any).msExitFullscreen();
  },
  toggleFullscreen(): boolean {
    if (document.fullscreenElement) {
      this.exitFullscreen();
      return false;
    }
    this.goFullscreen();
    return true;
  },
};
export default DomUtils;
