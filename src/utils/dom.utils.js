const DomUtils = {
  preventRightClick: element => {
    element.addEventListener('contextmenu', event => event.preventDefault());
  },

  preventZoom: () => {
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

  goFullscreen: function () {
    let element = document.documentElement; // Get the root element of the document
    if (element.requestFullscreen) {
      element.requestFullscreen(); // Standard
    } else if (element.mozRequestFullScreen) {
      element.mozRequestFullScreen(); // Firefox
    } else if (element.webkitRequestFullscreen) {
      element.webkitRequestFullscreen(); // Chrome, Safari, and Opera
    } else if (element.msRequestFullscreen) {
      element.msRequestFullscreen(); // Internet Explorer and Edge
    }
  },

  exitFullscreen: function () {
    if (document.exitFullscreen) {
      document.exitFullscreen(); // Standard
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen(); // Firefox
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen(); // Chrome, Safari and Opera
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen(); // Internet Explorer and Edge
    }
  },

  toggleFullscreen: function () {
    if (document.fullscreenElement) {
      this.exitFullscreen();
      return false;
    } else {
      this.goFullscreen();
      return true;
    }
  },
};

export default DomUtils;
